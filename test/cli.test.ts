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

/** Include the CLI's own diagnostics in a failing assertion. */
const expectOk = (result: ReturnType<typeof run>) => {
    expect(result.status, result.stderr.toString() || result.error?.message).toBe(0);
};

const xml = '<osm><node id="1" lat="0" lon="0"><tag k="name" v="a"/></node></osm>';

/**
 * Run `body` against a scratch path and remove it whether or not the body
 * throws: a failing assertion must not leave files behind in `test/expected`.
 */
function withScratchFile<T>(path: string, body: (path: string) => T): T {
    try {
        return body(path);
    } finally {
        fs.rmSync(path, { force: true });
    }
}

describe.skipIf(!built)('CLI', () => {
    it('converts a file to a file', () => {
        const output = 'test/expected/.cli-out.json';
        withScratchFile(output, (path) => {
            const result = run(['test/data/node.osm', path]);
            expectOk(result);
            const geojson = JSON.parse(fs.readFileSync(path, 'utf-8'));
            expect(geojson.type).toBe('FeatureCollection');
        });
    });

    it('reads stdin and writes stdout', () => {
        const result = run([], xml);
        expectOk(result);
        const geojson = JSON.parse(result.stdout.toString());
        expect(geojson.features[0].properties).toMatchObject({ id: 'node/1', name: 'a' });
    });

    it('decompresses gzip input', () => {
        withScratchFile('test/expected/.cli-in.osm.gz', (gzipped) => {
            fs.writeFileSync(gzipped, gzipSync(xml));
            const result = run([gzipped]);
            expectOk(result);
            expect(JSON.parse(result.stdout.toString()).features).toHaveLength(1);
        });
    });

    it('converts a real PBF extract', () => {
        const result = run(['test/data/monaco.osm.pbf']);
        expectOk(result);
        const geojson = JSON.parse(result.stdout.toString());
        expect(geojson.features.length).toBeGreaterThan(9000);
    });

    it('converts an osmChange diff', () => {
        const result = run(['test/data/monaco-960.osc']);
        expectOk(result);
        expect(JSON.parse(result.stdout.toString()).features.map((feature: any) => feature.id).sort())
            .toEqual(['node/14354106001', 'node/6684051501']);
    });

    it('fails with a hint for bzip2 input', () => {
        withScratchFile('test/expected/.cli-in.osm.bz2', (bzip2) => {
            fs.writeFileSync(bzip2, Buffer.from('BZh91AY&SY'));
            const result = run([bzip2]);
            expect(result.status).toBe(1);
            expect(result.stderr.toString()).toContain('bzip2 input is not supported');
        });
    });

    it('prints help', () => {
        const result = run(['--help']);
        expect(result.status).toBe(0);
        expect(result.stdout.toString()).toContain('Usage:');
    });
});
