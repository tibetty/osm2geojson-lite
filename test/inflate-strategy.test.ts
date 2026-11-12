import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange, toElements } from '../src/index';

/**
 * A server can replace the bundled zlib decoder with `node:zlib`, which is
 * about three times faster. The option has to reach the PBF reader through
 * every public entry point, and must produce exactly the same result.
 */
const pbf = new Uint8Array(fs.readFileSync('./test/data/monaco.osm.pbf'));
const zlibInflate = (data: Uint8Array, start: number, end: number) => new Uint8Array(inflateSync(data.subarray(start, end)));

describe('inflate strategy', () => {
    it('is used by osm2geojson and produces the same output', () => {
        const sizes: number[] = [];
        const spy = (data: Uint8Array, start: number, end: number, sizeHint: number) => {
            sizes.push(sizeHint);
            return zlibInflate(data, start, end);
        };

        const withDefault = osm2geojson(pbf, { completeFeature: true, renderTagged: true });
        const withZlib = osm2geojson(pbf, { completeFeature: true, renderTagged: true, inflate: spy });

        expect(sizes.length).toBeGreaterThan(0);
        expect(withZlib).toEqual(withDefault);
    });

    it('is used by toElements', () => {
        let called = 0;
        const elements = toElements(pbf, {
            inflate: (data, start, end) => {
                called++;
                return zlibInflate(data, start, end);
            },
        });
        expect(called).toBeGreaterThan(0);
        expect(elements).toHaveLength(toElements(pbf).length);
    });

    it('is used by mergeOsmChange and applyOsmChange', () => {
        let called = 0;
        const inflate = (data: Uint8Array, start: number, end: number) => {
            called++;
            return zlibInflate(data, start, end);
        };
        const diff = '<osmChange><modify><node id="1790048269" version="99999" lat="1" lon="2"/></modify></osmChange>';

        const merged = mergeOsmChange(pbf, diff, { inflate });
        expect(called).toBeGreaterThan(0);
        expect(merged.conflicts).toEqual([]);
        expect(merged.elements.length).toBeGreaterThan(40000);

        const applied = applyOsmChange(pbf, diff, { completeFeature: true, inflate });
        expect(applied.conflicts).toEqual([]);
    });

    it('rejects a corrupt blob with either inflater', () => {
        const corrupt = new Uint8Array(pbf);
        corrupt[2000] ^= 0x5a;
        expect(() => osm2geojson(corrupt, { completeFeature: true })).toThrow();
        expect(() => osm2geojson(corrupt, { completeFeature: true, inflate: zlibInflate })).toThrow();
    });

    it('leaves XML and JSON input untouched', () => {
        let called = false;
        const result = osm2geojson('<osm><node id="1" lat="0" lon="0"/></osm>', {
            completeFeature: true,
            inflate: () => { called = true; throw new Error('should not be called'); },
        });
        expect(called).toBe(false);
        expect((result as any).features).toHaveLength(1);
    });
});
