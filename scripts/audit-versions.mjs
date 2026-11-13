#!/usr/bin/env node
/**
 * Version audit: runs one battery of corner cases against every published
 * release in the range and checks that each behaviour is present from the
 * release that claims it, and never regresses afterwards.
 *
 *   npm run audit:versions                 # from 2.2.0 to the latest release
 *   npm run audit:versions -- --from 2.7.0 # shorter range
 *   npm run audit:versions -- --local-only # only the local dist/ build
 *
 * `npm test` runs this too. It needs the network to install the published
 * tarballs: offline it reports SKIP and audits the local build only, unless
 * `CI` is set or `--strict` is passed, where an unreachable registry fails. The published packages are installed into a
 * cache directory under node_modules and reused while their version list stays
 * the same. The `HEAD` column runs the local `dist/` build (`npm run build`).
 *
 * Every check names the release it became guaranteed in (`since`). Earlier
 * releases are reported for context and never gated, so a behaviour that was
 * merely accidental in an old version does not fail the audit.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file) => fs.readFileSync(path.join(repo, 'test/data', file), 'utf-8');
const bytes = (file) => new Uint8Array(fs.readFileSync(path.join(repo, 'test/data', file)));

const opts = { completeFeature: true, renderTagged: true, excludeWay: false, tainted: true };

/* --------------------------- tiny PBF encoder --------------------------- */
class Writer {
    b = [];
    varint(value) { let rest = value; while (rest >= 0x80) { this.b.push((rest % 0x80) | 0x80); rest = Math.floor(rest / 0x80); } this.b.push(rest); return this; }
    int64(value) { let rest = BigInt(value); if (rest < 0n) rest += 1n << 64n; for (;;) { const byte = Number(rest & 0x7fn); rest >>= 7n; if (rest === 0n) { this.b.push(byte); return this; } this.b.push(byte | 0x80); } }
    zigzag(value) { return this.varint(value >= 0 ? value * 2 : -value * 2 - 1); }
    tag(field, wire) { return this.varint((field << 3) | wire); }
    packed(field, values, zigzag) { const inner = new Writer(); for (const v of values) zigzag ? inner.zigzag(v) : inner.varint(v); return this.bytes(field, inner.done()); }
    string(field, value) { return this.bytes(field, new TextEncoder().encode(value)); }
    bytes(field, data) { this.tag(field, 2).varint(data.length); for (const byte of data) this.b.push(byte); return this; }
    done() { return new Uint8Array(this.b); }
}
const pbfFile = (blobs) => {
    const parts = [];
    for (const { type, payload, rawSize } of blobs) {
        const blob = new Writer().tag(2, 0).varint(rawSize ?? payload.length).bytes(3, new Uint8Array(deflateSync(payload)));
        const header = new Writer().string(1, type).tag(3, 0).varint(blob.done().length).done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, header.length);
        parts.push(length, header, blob.done());
    }
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { file.set(part, at); at += part.length; }
    return file;
};
const headerBlock = (features) => { const w = new Writer(); for (const f of features) w.string(4, f); return w.done(); };
const denseNodes = (nodes) => {
    const w = new Writer();
    let id = 0, lat = 0, lon = 0;
    const ids = [], lats = [], lons = [], keyVals = [];
    for (const node of nodes) {
        ids.push(node.id - id); id = node.id;
        const latRaw = node.latRaw ?? Math.round(node.lat * 1e7);
        const lonRaw = node.lonRaw ?? Math.round(node.lon * 1e7);
        lats.push(latRaw - lat); lat = latRaw;
        lons.push(lonRaw - lon); lon = lonRaw;
        keyVals.push(0);
    }
    return w.packed(1, ids, true).packed(8, lats, true).packed(9, lons, true).packed(10, keyVals, false);
};
const primitiveBlock = (strings, dense, ways = [], options = {}) => {
    const table = new Writer();
    for (const s of strings) table.string(1, s);
    const group = new Writer().bytes(2, dense.done());
    for (const way of ways) group.bytes(3, way.done());
    const block = new Writer().bytes(1, table.done()).bytes(2, group.done());
    if (options.granularity !== undefined) block.tag(17, 0).varint(options.granularity);
    if (options.latOffset !== undefined) block.tag(19, 0).int64(options.latOffset);
    if (options.lonOffset !== undefined) block.tag(20, 0).int64(options.lonOffset);
    return block.done();
};

/* -------------------------------- checks -------------------------------- */
const MULTIPOLYGON = {
    elements: [
        { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 1 },
        { type: 'node', id: 3, lat: 1, lon: 1 },
        { type: 'way', id: 10, nodes: [1, 2, 3, 1], tags: { natural: 'water' } },
        { type: 'relation', id: 20, tags: { type: 'multipolygon' }, members: [{ type: 'way', ref: 10, role: 'outer' }] },
    ],
};

const checks = [
    {
        name: '2.2.0: XML CDATA, entities and ">" in attributes',
        since: '2.2.0',
        run: (m) => {
            const xml = '<osm><node id="1" lat="0" lon="0"><tag k="note" v="a>b"/><tag k="name" v="A &amp; B"/><!-- <node id="9"/> --></node></osm>';
            const f = m.default(xml, { completeFeature: true });
            return f.features.length === 1 && f.features[0].properties.note === 'a>b' && f.features[0].properties.name === 'A & B';
        },
    },
    {
        name: '2.2.0: derived point and line geometry',
        since: '2.2.0',
        run: (m) => {
            const xml = '<osm><node id="1"><point lat="2" lon="3"/></node><way id="2"><vertex lat="0" lon="0"/><vertex lat="1" lon="1"/></way></osm>';
            const features = m.default(xml, { completeFeature: true }).features;
            return features.find((f) => f.id === 'node/1').geometry.type === 'Point'
                && features.find((f) => f.id === 'way/2').geometry.type === 'LineString';
        },
    },
    {
        name: '2.2.0: elementId resolves and reports taint',
        since: '2.2.0',
        run: (m) => {
            const data = { elements: [
                { type: 'way', id: 1, nodes: [1, 2, 3], tags: { highway: 'path' } },
                { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 3, lat: 1, lon: 1 },
            ] };
            const feature = m.default(data, { elementId: 'way/1', tainted: true });
            return Boolean(feature) && feature.id === 'way/1' && feature.properties['@tainted'] === true;
        },
    },
    {
        name: '2.2.1: duplicate way copies merge (JSON)',
        since: '2.2.1',
        run: (m) => {
            const data = { elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 1 },
                { type: 'way', id: 10, nodes: [1, 2] }, { type: 'way', id: 10, tags: { highway: 'path' }, version: 2 },
            ] };
            const way = m.default(data, { completeFeature: true }).features.find((f) => f.id === 'way/10');
            return way && way.geometry.type === 'LineString' && way.properties.highway === 'path';
        },
    },
    {
        name: '2.3.0: visible=false skipped',
        since: '2.3.0',
        run: (m) => {
            const data = { elements: [{ type: 'node', id: 1, lat: 0, lon: 0, visible: false }, { type: 'node', id: 2, lat: 0, lon: 1 }] };
            const ids = m.default(data, { completeFeature: true }).features.map((f) => f.id);
            return ids.length === 1 && ids[0] === 'node/2';
        },
    },
    {
        name: '2.3.0: old-style multipolygon attributed to the outer way',
        since: '2.3.0',
        run: (m) => {
            const features = m.default(MULTIPOLYGON, opts).features;
            const ids = features.map((f) => f.id);
            return ids.includes('way/10') && !ids.includes('relation/20')
                && features.find((f) => f.id === 'way/10').geometry.type === 'Polygon';
        },
    },
    {
        name: '2.4.0: route platform way released independently',
        since: '2.4.0',
        run: (m) => {
            const data = { elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 }, { type: 'node', id: 2, lat: 0, lon: 1 },
                { type: 'node', id: 3, lat: 1, lon: 1 }, { type: 'node', id: 4, lat: 1, lon: 2 },
                { type: 'way', id: 10, nodes: [1, 2] }, { type: 'way', id: 11, nodes: [3, 4], tags: { amenity: 'parking' } },
                { type: 'relation', id: 20, tags: { type: 'route' }, members: [{ type: 'way', ref: 10, role: '' }, { type: 'way', ref: 11, role: 'platform' }] },
            ] };
            // Default options: an absorbed way is not emitted, so this only
            // passes when the platform member was released.
            return m.default(data, { completeFeature: true }).features.some((f) => f.id === 'way/11');
        },
    },
    {
        name: '2.5.0: osmChange create / modify / delete',
        since: '2.5.0',
        run: (m) => {
            const xml = '<osmChange><create><node id="1" version="1" lat="0" lon="0"/></create><modify><node id="2" version="2" lat="0" lon="1"/></modify><delete><node id="3" version="2"/></delete></osmChange>';
            const ids = m.default(xml, { completeFeature: true }).features.map((f) => f.id);
            return ids.length === 2 && ids.includes('node/1') && ids.includes('node/2');
        },
    },
    {
        name: '2.5.0: PBF extract decodes',
        since: '2.5.0',
        run: (m) => m.default(bytes('monaco.osm.pbf'), { completeFeature: true, renderTagged: true }).features.length > 9000,
    },
    {
        name: '2.5.0: history resolves to the newest version',
        since: '2.5.0',
        run: (m) => {
            const feature = m.default(read('history-node-1690189834.osm'), { completeFeature: true }).features[0];
            return feature && feature.properties.version === '4' && feature.geometry.coordinates[1] === 43.7380349;
        },
    },
    {
        name: '2.5.1: corrupt zlib blob rejected',
        since: '2.5.1',
        run: (m) => {
            const buffer = bytes('monaco.osm.pbf');
            buffer[2000] ^= 0x5a;
            try { m.default(buffer, { completeFeature: true }); return false; } catch (error) { return /checksum|deflate|PBF/.test(error.message); }
        },
    },
    {
        name: '2.7.0: applyOsmChange merges and reports conflicts',
        since: '2.7.0',
        run: (m) => {
            if (!m.applyOsmChange || !m.mergeOsmChange || !m.toElements) return false;
            const base = { elements: [{ type: 'node', id: 1, version: 1, lat: 0, lon: 0 }] };
            const applied = m.applyOsmChange(base, '<osmChange><modify><node id="1" version="2" lat="5" lon="6"/></modify></osmChange>', { completeFeature: true });
            const stale = m.mergeOsmChange({ elements: [{ type: 'node', id: 1, version: 3, lat: 0, lon: 0 }] },
                '<osmChange><modify><node id="1" version="2" lat="9" lon="9"/></modify></osmChange>');
            return applied.geojson.features[0].geometry.coordinates[0] === 6
                && applied.conflicts.length === 0
                && stale.conflicts.length === 1
                && stale.elements[0].lat === 0;
        },
    },
    {
        name: '2.7.2: no duplicate feature ids',
        since: '2.7.2',
        run: (m) => {
            const ids = m.default(read('original.osm'), opts).features.map((f) => f.id);
            return new Set(ids).size === ids.length;
        },
    },
    {
        name: '2.7.2: old-style multipolygon emitted once',
        since: '2.7.2',
        run: (m) => m.default(MULTIPOLYGON, opts).features.filter((f) => f.id === 'way/10').length === 1,
    },
    {
        name: '2.7.2: null element tolerated',
        since: '2.7.2',
        run: (m) => {
            try {
                return m.default({ elements: [null, { type: 'node', id: 1, lat: 0, lon: 0 }] }, { completeFeature: true }).features.length === 1;
            } catch { return false; }
        },
    },
    {
        name: '2.7.2: unversioned tombstone keeps a newer element',
        since: '2.7.2',
        run: (m) => m.default({ elements: [{ type: 'node', id: 1, version: 3, lat: 0, lon: 0 }, { type: 'node', id: 1, visible: false }] }, { completeFeature: true }).features.length === 1,
    },
    {
        name: '2.7.2: PBF int64 way id and block offsets',
        since: '2.7.2',
        run: (m) => {
            const way = new Writer().tag(1, 0).int64(5).packed(8, [1, 1], true);
            const file = pbfFile([
                { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
                {
                    type: 'OSMData',
                    payload: primitiveBlock([''], denseNodes([{ id: 1, lat: 0, lon: 0 }, { id: 2, lat: 0, lon: 0 }]), [way], {
                        granularity: 1000, latOffset: 1000, lonOffset: 2000,
                    }),
                },
            ]);
            const wayFeature = m.default(file, { completeFeature: true, renderTagged: true, excludeWay: false }).features.find((f) => f.id === 'way/5');
            return Boolean(wayFeature)
                && wayFeature.geometry.coordinates[0][0] === 0.000002
                && wayFeature.geometry.coordinates[0][1] === 0.000001;
        },
    },
    {
        name: '2.7.3: delete applies at the version it names',
        since: '2.7.3',
        run: (m) => {
            const applied = m.applyOsmChange({ elements: [{ type: 'node', id: 1, version: 4, lat: 0, lon: 0 }] },
                '<osmChange><delete><node id="1" version="4"/></delete></osmChange>', { completeFeature: true });
            return applied.conflicts.length === 0 && applied.geojson.features.length === 0;
        },
    },
    {
        name: '2.7.6: CommonJS entry is callable with named exports',
        since: '2.7.6',
        run: (module, cjs) => {
            try {
                const mod = createRequire(import.meta.url)(cjs);
                return typeof mod === 'function' && mod.default === mod && typeof mod.applyOsmChange === 'function';
            } catch {
                return false;
            }
        },
    },
    {
        name: '2.8.0: format entries are complete and strict',
        since: '2.8.0',
        run: (module, cjs) => {
            const dir = path.dirname(cjs);
            const load = (name) => {
                try { return createRequire(import.meta.url)(path.join(dir, `${name}.cjs`)); } catch { return undefined; }
            };
            const entries = { xml: load('xml'), json: load('json'), pbf: load('pbf') };
            if (!Object.values(entries).every((entry) => typeof entry === 'function' && typeof entry.toElements === 'function')) return false;
            const xmlInput = '<osm><node id="1" lat="0" lon="0"/></osm>';
            const jsonInput = { elements: [{ type: 'node', id: 1, lat: 0, lon: 0 }] };
            const rejects = (entry, input) => {
                try { entry(input, opts); return false; } catch (error) { return /does not read/.test(error.message); }
            };
            return rejects(entries.xml, jsonInput)
                && rejects(entries.xml, bytes('monaco.osm.pbf'))
                && rejects(entries.json, xmlInput)
                && rejects(entries.pbf, xmlInput)
                && entries.xml(xmlInput, { completeFeature: true }).features.length === 1
                && entries.json(jsonInput, { completeFeature: true }).features.length === 1;
        },
    },
    {
        name: '2.7.4: implausible raw_size stays bounded',
        since: '2.7.4',
        run: (m) => {
            const file = pbfFile([
                { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6']) },
                { type: 'OSMData', payload: new Uint8Array(1024), rawSize: 0x7fffffff },
            ]);
            const before = process.memoryUsage().rss;
            try { m.default(file, { completeFeature: true }); } catch { /* rejecting is fine */ }
            return process.memoryUsage().rss - before < 300 * 1024 * 1024;
        },
    },
];

const cliChecks = [
    {
        name: 'CLI: file and gzip input, bzip2 hint',
        since: '2.6.0',
        // File to file, so this does not depend on the stdin/stdout fix below.
        run: (cli, scratch) => {
            const out = path.join(scratch, 'cli-file.json');
            const gz = path.join(scratch, 'cli-gz.json');
            const okFile = runCli(cli, [path.join(repo, 'test/data/node.osm'), out]).code === 0 && exists(out);
            const okGzip = runCli(cli, [path.join(repo, 'test/data/monaco-960.osc.gz'), gz]).code === 0 && exists(gz);
            const bzip2 = runCli(cli, [bzip2File, out]);
            fs.rmSync(out, { force: true });
            fs.rmSync(gz, { force: true });
            return okFile && okGzip && bzip2.code === 1 && /bzip2 input is not supported/.test(bzip2.err);
        },
    },
    {
        name: 'CLI: stdin to stdout',
        since: '2.7.2',
        // Before 2.7.2 the CLI opened /dev/stdin and /dev/stdout, which fails on
        // Linux whenever they are pipes.
        run: (cli) => {
            const result = runCli(cli, [], '<osm><node id="1" lat="0" lon="0"/></osm>');
            return result.code === 0 && result.out.trim().startsWith('{');
        },
    },
];

/* ------------------------------ arguments ------------------------------ */
const argv = process.argv.slice(2);
const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
};
if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
        'Audit every published release against the behaviours it claims.',
        '',
        'Usage: npm run audit:versions [-- options]',
        '',
        '  --from <version>  first release to audit (default 2.2.0)',
        '  --local-only      skip published tarballs, audit `dist/` only',
        '  --help            this text',
        '',
        'Installed tarballs are cached in node_modules/.cache/osm2geojson-audit.',
        '',
    ].join('\n'));
    process.exit(0);
}
const from = option('--from') || '2.2.0';
const local = argv.includes('--local-only');
const strict = argv.includes('--strict') || Boolean(process.env.CI);

/* --------------------------- install & load ---------------------------- */
const compare = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
};

function publishedVersions() {
    const json = execFileSync('npm', ['view', 'osm2geojson-lite', 'versions', '--json'], { encoding: 'utf-8' });
    const versions = JSON.parse(json);
    const latest = JSON.parse(execFileSync('npm', ['view', 'osm2geojson-lite', 'dist-tags.latest', '--json'], { encoding: 'utf-8' }));
    return versions.filter((version) => compare(version, from) >= 0 && !version.includes('-') && compare(version, latest) <= 0);
}

function install(versions) {
    const cache = path.join(repo, 'node_modules', '.cache', 'osm2geojson-audit');
    const marker = path.join(cache, 'versions.json');
    const alias = (version) => `v${version.replace(/\./g, '')}`;

    let cached = [];
    try { cached = JSON.parse(fs.readFileSync(marker, 'utf-8')); } catch { /* not installed yet */ }
    if (cached.length !== versions.length || cached.some((version) => !versions.includes(version))) {
        fs.rmSync(cache, { recursive: true, force: true });
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(path.join(cache, 'package.json'), JSON.stringify({ name: 'osm2geojson-audit', private: true }));
        const specs = versions.map((version) => `${alias(version)}@npm:osm2geojson-lite@${version}`);
        process.stdout.write(`installing ${versions.length} published versions into ${path.relative(repo, cache)} ...\n`);
        execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', ...specs], { cwd: cache, stdio: ['ignore', 'ignore', 'inherit'] });
        fs.writeFileSync(marker, JSON.stringify(versions));
    }
    return { dir: cache, entry: (version) => path.join(cache, 'node_modules', alias(version), 'dist', 'index.mjs') };
}

let versions = [];
let skipped = '';
if (!local) {
    try {
        versions = publishedVersions();
    } catch (error) {
        if (strict) {
            process.stderr.write(`cannot reach the npm registry: ${error.message}\n`);
            process.exit(1);
        }
        // Offline: still audit the local build, and say why the rest is missing.
        skipped = `SKIP published versions: ${error.message.split('\n')[0]}`;
        process.stdout.write(`${skipped}\n`);
    }
}
const { dir, entry } = versions.length ? install(versions) : { dir: undefined, entry: undefined };

const headDist = path.join(repo, 'dist', 'index.mjs');
const columns = [
    ...versions.map((version) => {
        const pkg = path.join(dir, 'node_modules', `v${version.replace(/\./g, '')}`, 'dist');
        return { label: version, spec: pathToFileURL(path.join(pkg, 'index.mjs')).href, cli: path.join(pkg, 'cli.mjs'), cjs: path.join(pkg, 'index.cjs') };
    }),
    { label: 'HEAD', spec: pathToFileURL(headDist).href, cli: path.join(repo, 'dist', 'cli.mjs'), cjs: path.join(repo, 'dist', 'index.cjs') },
];

if (!fs.existsSync(headDist)) {
    process.stderr.write('dist/ is missing: run `npm run build` first.\n');
    process.exit(1);
}

const modules = new Map();
for (const column of columns) {
    modules.set(column.label, await import(column.spec));
}

/* ------------------------------- library ------------------------------- */
const results = new Map();
for (const column of columns) {
    const module = modules.get(column.label);
    const row = [];
    for (const check of checks) {
        let outcome;
        try { outcome = check.run(module, column.cjs); } catch { outcome = false; }
        row.push(outcome === true);
    }
    results.set(column.label, row);
}

const cell = (ok, gated) => (ok ? 'ok' : gated ? 'FAIL' : '--').padStart(6);
const width = Math.max(...checks.map((check) => check.name.length)) + 2;
process.stdout.write('\n'.padEnd(width) + columns.map((column) => column.label.padStart(6)).join('') + '\n');
let failures = 0;
checks.forEach((check, index) => {
    const cells = columns.map((column) => {
        const gated = column.label === 'HEAD' || compare(column.label, check.since) >= 0;
        const ok = results.get(column.label)[index];
        if (gated && !ok) failures++;
        return cell(ok, gated);
    });
    process.stdout.write(`${check.name.padEnd(width - 1)} ${cells.join('')}\n`);
});

/* --------------------------------- CLI --------------------------------- */
const runCli = (cli, args, input) => {
    try {
        const out = execFileSync(process.execPath, [cli, ...args], {
            input, encoding: 'utf-8', maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { code: 0, out };
    } catch (error) {
        return { code: error.status ?? -1, out: String(error.stdout ?? ''), err: String(error.stderr ?? '') };
    }
};
const exists = (file) => fs.existsSync(file) && fs.statSync(file).size > 0;
const bzip2File = path.join(repo, 'node_modules', '.cache', 'audit.bz2');
const scratch = path.join(repo, 'node_modules', '.cache', 'osm2geojson-audit-scratch');
fs.mkdirSync(scratch, { recursive: true });
fs.writeFileSync(bzip2File, Buffer.from('BZh91AY&SY'));

process.stdout.write('\nCLI'.padEnd(width - 1) + columns.map((column) => column.label.padStart(6)).join('') + '\n');
for (const check of cliChecks) {
    const cells = columns.map((column) => {
        const gated = column.label === 'HEAD' || compare(column.label, check.since) >= 0;
        let ok = false;
        try { ok = check.run(column.cli, scratch) === true; } catch { ok = false; }
        if (gated && !ok) failures++;
        return cell(ok, gated);
    });
    process.stdout.write(`${check.name.padEnd(width - 1)} ${cells.join('')}\n`);
}

process.stdout.write(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} gated check(s) failed.${skipped ? ' (published versions skipped)' : ''}\n`);
process.stdout.write('ok = passes, -- = before the release that guarantees it, FAIL = regression.\n');
process.exit(failures === 0 ? 0 : 1);
