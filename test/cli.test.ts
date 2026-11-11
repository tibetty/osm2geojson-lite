import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';

/**
 * End-to-end CLI coverage. The binary is TypeScript-compiled into `dist/`, so
 * these cases only run after `npm run build` (CI builds before testing); a plain
 * `npm test` on a fresh checkout skips them instead of failing.
 */
const cli = './dist/cli.mjs';
const built = fs.existsSync(cli);

// The Monaco extract produces ~8 MB of GeoJSON on stdout.
const run = (args: string[], input?: Buffer | string) => spawnSync(process.execPath, [cli, ...args], { input, maxBuffer: 64 * 1024 * 1024 });

const xml = '<osm><node id="1" lat="0" lon="0"><tag k="name" v="a"/></node></osm>';

describe.skipIf(!built)('CLI', () => {
    it('converts a file to a file', () => {
        const output = 'test/expected/.cli-out.json';
        const result = run(['test/data/node.osm', output]);
        expect(result.status).toBe(0);
        const geojson = JSON.parse(fs.readFileSync(output, 'utf-8'));
        expect(geojson.type).toBe('FeatureCollection');
        fs.rmSync(output);
    });

    it('reads stdin and writes stdout', () => {
        const result = run([], xml);
        expect(result.status).toBe(0);
        const geojson = JSON.parse(result.stdout.toString());
        expect(geojson.features[0].properties).toMatchObject({ id: 'node/1', name: 'a' });
    });

    it('decompresses gzip input', () => {
        const gzipped = 'test/expected/.cli-in.osm.gz';
        fs.writeFileSync(gzipped, gzipSync(xml));
        const result = run([gzipped]);
        fs.rmSync(gzipped);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.toString()).features).toHaveLength(1);
    });

    it('converts a real PBF extract', () => {
        const result = run(['test/data/monaco.osm.pbf']);
        expect(result.status).toBe(0);
        const geojson = JSON.parse(result.stdout.toString());
        expect(geojson.features.length).toBeGreaterThan(9000);
    });

    it('converts an osmChange diff', () => {
        const result = run(['test/data/monaco-960.osc']);
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout.toString()).features.map((feature: any) => feature.id).sort())
            .toEqual(['node/14354106001', 'node/6684051501']);
    });

    it('fails with a hint for bzip2 input', () => {
        const bzip2 = 'test/expected/.cli-in.osm.bz2';
        fs.writeFileSync(bzip2, Buffer.from('BZh91AY&SY'));
        const result = run([bzip2]);
        fs.rmSync(bzip2);
        expect(result.status).toBe(1);
        expect(result.stderr.toString()).toContain('bzip2 input is not supported');
    });

    it('prints help', () => {
        const result = run(['--help']);
        expect(result.status).toBe(0);
        expect(result.stdout.toString()).toContain('Usage:');
    });
});
