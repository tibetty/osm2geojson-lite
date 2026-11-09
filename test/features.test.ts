import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';

const json = (elements: any[], opts?: any) => osm2geojson({ elements }, { completeFeature: true, ...opts }) as any;

describe('Overpass derived geometries', () => {
    it('uses a GeoJSON geometry object carried by a JSON element', () => {
        const result = json([
            { type: 'way', id: 10, tags: { highway: 'path' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
        ]);
        const feature = result.features.find((f: any) => f.id === 'way/10');
        expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(feature.properties).toMatchObject({ id: 'way/10', highway: 'path' });
    });

    it('builds point, line and polygon geometries from derived XML', () => {
        const xml = `<osm>
            <node id="1"><tag k="name" v="p"/><point lat="2" lon="3"/></node>
            <way id="2"><vertex lat="0" lon="0"/><vertex lat="1" lon="1"/></way>
            <relation id="3"><linestring><vertex lat="0" lon="0"/><vertex lat="0" lon="1"/><vertex lat="1" lon="0"/><vertex lat="0" lon="0"/></linestring></relation>
        </osm>`;
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        const byId = (id: string) => result.features.find((f: any) => f.id === id);
        expect(byId('node/1').geometry).toEqual({ type: 'Point', coordinates: [3, 2] });
        expect(byId('way/2').geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(byId('relation/3').geometry).toEqual({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]],
        });
    });
});

describe('out center', () => {
    it('falls back to a way centre when no nodes are present', () => {
        const result = json([{ type: 'way', id: 1, tags: { highway: 'bus_stop' }, center: { lat: 1, lon: 2 } }]);
        expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
    });

    it('falls back to a relation centre when no geometry can be assembled', () => {
        const result = json([{ type: 'relation', id: 2, tags: { type: 'route' }, center: { lat: 3, lon: 4 } }]);
        expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [4, 3] });
    });

    it('reads a way centre from XML', () => {
        const xml = '<osm><way id="1"><center lat="1" lon="2"/><tag k="highway" v="bus_stop"/></way></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
    });
});

describe('elementId', () => {
    const data = {
        elements: [
            { type: 'node', id: 1, lat: 10, lon: 20, tags: { name: 'n' } },
            { type: 'way', id: 2, nodes: [1], tags: { highway: 'path' } },
        ],
    };

    it('returns a single feature by composite id', () => {
        const feature = osm2geojson(data, { elementId: 'node/1' }) as any;
        expect(feature.type).toBe('Feature');
        expect(feature.id).toBe('node/1');
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [20, 10] });
    });

    it('returns undefined for an unknown element', () => {
        expect(osm2geojson(data, { elementId: 'node/404' })).toBeUndefined();
    });
});

describe('relation member handling', () => {
    it('does not duplicate a way listed twice with the same role (issue #48)', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'node', id: 4, lat: 1, lon: 0 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { natural: 'water' } },
            {
                type: 'relation', id: 20, tags: { type: 'multipolygon' },
                members: [
                    { type: 'way', ref: 10, role: 'outer' },
                    { type: 'way', ref: 10, role: 'outer' },
                ],
            },
        ]);
        const relation = result.features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry.type).toBe('Polygon');
        expect(relation.geometry.coordinates[0]).toHaveLength(5);
    });

    it('does not duplicate a sub-relation listed twice', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'node', id: 4, lat: 1, lon: 0 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { natural: 'water' } },
            { type: 'relation', id: 11, members: [{ type: 'way', ref: 10, role: 'outer' }] },
            {
                type: 'relation', id: 20, tags: { type: 'multipolygon' },
                members: [
                    { type: 'relation', ref: 11, role: 'outer' },
                    { type: 'relation', ref: 11, role: 'outer' },
                ],
            },
        ]);
        const relation = result.features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry.type).toBe('Polygon');
        expect(relation.geometry.coordinates[0]).toHaveLength(5);
    });
});

describe('XML entity decoding', () => {
    it('decodes named and numeric entities in attributes and text', () => {
        const xml = '<osm><node id="1" lat="0" lon="0"><tag k="name" v="A &amp; B &#65; &#x42; &lt;&gt;&quot;&apos;"/></node></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features[0].properties.name).toBe('A & B A B <>\"\'');
    });
});

describe('tainted references', () => {
    const data = {
        elements: [
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 99, 2], tags: { highway: 'path' } },
        ],
    };

    it('omits @tainted by default', () => {
        const result = json(data.elements);
        expect(result.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(result.features[0].properties['@tainted']).toBeUndefined();
    });

    it('exposes @tainted when requested', () => {
        const result = json(data.elements, { tainted: true });
        expect(result.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(result.features[0].properties['@tainted']).toBe(true);
    });
});

describe('polygonTags override', () => {
    const data = {
        elements: [
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'node', id: 4, lat: 1, lon: 0 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { amenity: 'parking' } },
        ],
    };

    it('uses the built-in rules by default', () => {
        const result = json(data.elements);
        expect(result.features[0].geometry.type).toBe('Polygon');
    });

    it('honours caller supplied rules', () => {
        const result = json(data.elements, { polygonTags: {} });
        expect(result.features[0].geometry.type).toBe('LineString');
    });
});
