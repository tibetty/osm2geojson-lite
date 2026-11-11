import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange, toElements } from '../src/index';

/** Input handling and public API edges that fixtures do not reach. */

describe('input handling', () => {
    it('returns an empty collection for input it cannot recognise', () => {
        expect(osm2geojson(42 as any, { completeFeature: true })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(osm2geojson('hello', { completeFeature: true })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(osm2geojson({} as any, { completeFeature: true })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(osm2geojson({ elements: 'nope' } as any, { completeFeature: true }))
            .toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('parses a JSON string', () => {
        const result = osm2geojson('{"elements":[{"type":"node","id":1,"lat":0,"lon":0}]}', { completeFeature: true }) as any;
        expect(result.features).toHaveLength(1);
    });

    it('treats a JSON string without elements as empty', () => {
        expect(osm2geojson('{"foo":1}', { completeFeature: true })).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('skips elements that carry no type or id', () => {
        const result = osm2geojson({ elements: [{ type: 'node' }, null, { id: 5 }, { type: 'node', id: 1, lat: 0, lon: 0 }] }, { completeFeature: true }) as any;
        expect(result.features.map((feature: any) => feature.id)).toEqual(['node/1']);
    });

    it('returns undefined for an element id that does not exist', () => {
        expect(osm2geojson({ elements: [] }, { elementId: 'node/1' })).toBeUndefined();
        expect(osm2geojson({ elements: [] }, { elementId: 'banana/1' })).toBeUndefined();
    });

    it('returns the first relation geometry without completeFeature', () => {
        const result = osm2geojson({
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 1 },
                { type: 'way', id: 10, nodes: [1, 2] },
                { type: 'relation', id: 20, tags: { type: 'route' }, members: [{ type: 'way', ref: 10, role: '' }] },
            ],
        }) as any;
        expect(result).toEqual({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]]] });
    });
});

describe('public API edges', () => {
    it('normalises unrecognised input to no elements', () => {
        expect(toElements(42 as any)).toEqual([]);
        expect(toElements('nonsense')).toEqual([]);
        expect(toElements({} as any)).toEqual([]);
    });

    it('merges into an empty base', () => {
        const merged = mergeOsmChange({ elements: [] }, '<osmChange><create><node id="1" version="1" lat="0" lon="0"/></create></osmChange>');
        expect(merged.elements).toHaveLength(1);
        expect(merged.conflicts).toEqual([]);
    });

    it('passes elementId through applyOsmChange', () => {
        const base = { elements: [{ type: 'node', id: 1, version: 1, lat: 0, lon: 0 }] };
        const applied = applyOsmChange(base, '<osmChange><modify><node id="1" version="2" lat="5" lon="6"/></modify></osmChange>', { elementId: 'node/1' });
        expect((applied.geojson as any).geometry).toEqual({ type: 'Point', coordinates: [6, 5] });
        expect(applied.conflicts).toEqual([]);
    });

    it('returns no geojson and no conflicts for an empty diff over an empty base', () => {
        const applied = applyOsmChange({ elements: [] }, '<osmChange></osmChange>', { completeFeature: true });
        expect(applied.geojson).toEqual({ type: 'FeatureCollection', features: [] });
        expect(applied.conflicts).toEqual([]);
    });

    it('reports a stale create that collides with a newer base', () => {
        const base = { elements: [{ type: 'node', id: 1, version: 5, lat: 0, lon: 0 }] };
        const merged = mergeOsmChange(base, '<osmChange><create><node id="1" version="1" lat="9" lon="9"/></create></osmChange>');
        expect(merged.conflicts).toEqual([{ id: 'node/1', changeVersion: 1, baseVersion: 5 }]);
        expect(merged.elements[0]).toMatchObject({ version: 5 });
    });
});
