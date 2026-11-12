import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

/**
 * The CommonJS entry historically exported the converter function directly.
 * Adding named exports in 2.7.0 made bundlers emit `exports.default`, so
 * `require('osm2geojson-lite')(osm)` became a TypeError. The build appends a
 * footer that restores the callable shape; this pins it.
 */
const require = createRequire(import.meta.url);
const built = fs.existsSync(new URL('../dist/index.cjs', import.meta.url));

describe.skipIf(!built)('CommonJS entry', () => {
    const mod = built ? require('../dist/index.cjs') : undefined;

    it('is callable, like before named exports existed', () => {
        expect(typeof mod).toBe('function');
        const geojson = mod({ elements: [{ type: 'node', id: 1, lat: 0, lon: 0 }] }, { completeFeature: true });
        expect(geojson.features).toHaveLength(1);
    });

    it('exposes the same function as `default`', () => {
        expect(mod.default).toBe(mod);
    });

    it('exposes the named exports on the callable', () => {
        for (const name of ['applyOsmChange', 'mergeOsmChange', 'toElements']) {
            expect(typeof mod[name]).toBe('function');
        }
        const applied = mod.applyOsmChange({ elements: [] }, '<osmChange></osmChange>', { completeFeature: true });
        expect(applied.conflicts).toEqual([]);
        expect(mod.toElements({ elements: [] })).toEqual([]);
    });

    it('destructures like a normal namespace', () => {
        const { applyOsmChange, mergeOsmChange } = mod;
        expect(applyOsmChange).toBe(mod.applyOsmChange);
        expect(mergeOsmChange({ elements: [] }, { elements: [] })).toEqual({ elements: [], conflicts: [] });
    });
});
