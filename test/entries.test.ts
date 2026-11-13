import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange, toElements } from '../src/index';

/**
 * The format entries are build artifacts, so these tests read `dist/`. They are
 * skipped on a fresh checkout without a build (CI builds before testing).
 *
 * Two properties matter and are easy to lose silently:
 *  1. an entry converts its own format exactly like the default entry;
 *  2. an entry does not carry the parsers it rejects — otherwise the split
 *     stops saving bytes without anyone noticing.
 */
const dist = new URL('../dist/', import.meta.url);
const built = fs.existsSync(new URL('xml.mjs', dist));

const require = createRequire(import.meta.url);
const readDist = (file: string) => fs.readFileSync(new URL(file, dist), 'utf-8');
const size = (file: string) => fs.statSync(new URL(file, dist)).size;

const readFixture = (file: string): any =>
    file.endsWith('.json') ? JSON.parse(fs.readFileSync(`./test/data/${file}`, 'utf-8'))
        : file.endsWith('.pbf') ? new Uint8Array(fs.readFileSync(`./test/data/${file}`))
            : fs.readFileSync(`./test/data/${file}`, 'utf-8');

const opts = { completeFeature: true, renderTagged: true, excludeWay: false } as const;

describe.skipIf(!built)('format entry points', () => {
    const entries = {
        xml: require('../dist/xml.cjs') as any,
        json: require('../dist/json.cjs') as any,
        pbf: require('../dist/pbf.cjs') as any,
    };

    it('are callable and expose the whole API', () => {
        for (const [name, entry] of Object.entries(entries)) {
            expect(typeof entry, name).toBe('function');
            expect(entry.default, name).toBe(entry);
            for (const fn of ['osm2geojson', 'toElements', 'mergeOsmChange', 'applyOsmChange']) {
                expect(typeof (fn === 'osm2geojson' ? entry : entry[fn]), `${name}.${fn}`).not.toBe('undefined');
            }
            expect(typeof entry.toElements).toBe('function');
            expect(typeof entry.mergeOsmChange).toBe('function');
            expect(typeof entry.applyOsmChange).toBe('function');
        }
    });

    it('convert their own format exactly like the default entry', () => {
        const cases: Array<[keyof typeof entries, string[]]> = [
            ['xml', ['node.osm', 'relation.osm', 'monaco-960.osc']],
            ['json', ['node.json', 'way.json', 'hebei.json']],
            ['pbf', ['monaco.osm.pbf']],
        ];
        for (const [name, files] of cases) {
            for (const file of files) {
                const input = readFixture(file);
                expect(entries[name](input, opts), `${name} · ${file}`).toEqual(osm2geojson(input, opts));
                expect(entries[name].toElements(input).length, `${name} · ${file} elements`)
                    .toBe(toElements(input).length);
            }
        }
    });

    it('reject other formats and name the right entry', () => {
        const xml = '<osm><node id="1" lat="0" lon="0"/></osm>';
        const json = { elements: [{ type: 'node', id: 1, lat: 0, lon: 0 }] };
        const pbf = readFixture('monaco.osm.pbf');

        expect(() => entries.xml(pbf, opts)).toThrow(/"osm2geojson-lite\/xml" does not read pbf input.*osm2geojson-lite\/pbf/);
        expect(() => entries.xml(json, opts)).toThrow(/does not read json input/);
        expect(() => entries.xml(JSON.stringify(json), opts)).toThrow(/does not read json input/);
        expect(() => entries.json(xml, opts)).toThrow(/"osm2geojson-lite\/json" does not read xml input.*osm2geojson-lite\/xml/);
        expect(() => entries.pbf(xml, opts)).toThrow(/does not read xml input/);
    });

    it('keep the element-level API on their own format', () => {
        const base = '<osm><node id="1" version="1" lat="0" lon="0"/></osm>';
        const diff = '<osmChange><modify><node id="1" version="2" lat="5" lon="6"/></modify></osmChange>';
        expect(entries.xml.mergeOsmChange(base, diff).conflicts).toEqual([]);
        expect(entries.xml.applyOsmChange(base, diff, { completeFeature: true }).geojson.features[0].geometry.coordinates)
            .toEqual([6, 5]);
        expect(entries.json.toElements(JSON.stringify({ elements: [] }))).toEqual([]);
    });

    it('do not carry the parsers they reject', () => {
        // Markers are string literals from the excluded modules; minification
        // keeps literals, so their presence means the module was re-coupled.
        expect(readDist('xml.mjs')).not.toContain('truncated PBF varint');
        expect(readDist('xml.mjs')).not.toContain('invalid deflate Huffman tree');
        expect(readDist('json.mjs')).not.toContain('truncated PBF varint');
        expect(readDist('json.mjs')).not.toContain('CDATA');
        // The PBF decoder inflates its own blobs, so inflate stays there.
        expect(readDist('xml.mjs')).not.toContain('invalid deflate Huffman tree');
        expect(readDist('json.mjs')).not.toContain('invalid deflate Huffman tree');
        expect(readDist('pbf.mjs')).not.toContain('CDATA');
        expect(readDist('index.mjs')).toContain('truncated PBF varint');
        expect(readDist('index.mjs')).toContain('CDATA');
    });

    it('stay under their size ceilings', () => {
        expect(size('index.mjs')).toBeLessThan(60_000);
        expect(size('xml.mjs')).toBeLessThan(45_000);
        expect(size('json.mjs')).toBeLessThan(38_000);
        expect(size('pbf.mjs')).toBeLessThan(50_000);
    });
});
