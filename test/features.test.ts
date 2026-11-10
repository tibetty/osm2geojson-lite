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

describe('out bb bounds fallback', () => {
    const ring = [[1, 0], [3, 0], [3, 2], [1, 2], [1, 0]];

    it('builds a polygon for a bounds-only JSON way', () => {
        const result = json([{ type: 'way', id: 1, tags: { highway: 'path' }, bounds: { minlat: 0, minlon: 1, maxlat: 2, maxlon: 3 } }]);
        expect(result.features[0].id).toBe('way/1');
        expect(result.features[0].geometry).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    it('builds a polygon for a bounds-only JSON relation', () => {
        const result = json([{ type: 'relation', id: 2, tags: { type: 'multipolygon' }, bounds: { minlat: 0, minlon: 1, maxlat: 2, maxlon: 3 } }]);
        const relation = result.features.find((f: any) => f.id === 'relation/2');
        expect(relation.geometry).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    it('builds a polygon for a bounds-only XML way', () => {
        const xml = '<osm><way id="1"><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/><tag k="highway" v="path"/></way></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features[0].geometry).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    it('builds a polygon for a bounds-only XML relation', () => {
        const xml = '<osm><relation id="2"><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/><tag k="type" v="multipolygon"/></relation></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features[0].geometry).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    it('prefers real coordinates over bounds', () => {
        const xml = '<osm><node id="9" lat="0" lon="0"/><node id="10" lat="1" lon="1"/><way id="1"><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/><nd ref="9"/><nd ref="10"/></way></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });
});

describe('relation stitching order', () => {
    it('stitches a later member that joins the head when the next member is disconnected', () => {
        const result = json([
            { type: 'node', id: 0, lat: 0, lon: 0 },
            { type: 'node', id: 1, lat: 0, lon: 1 },
            { type: 'node', id: 2, lat: 0, lon: 2 },
            { type: 'node', id: 8, lat: 5, lon: 5 },
            { type: 'node', id: 9, lat: 5, lon: 6 },
            { type: 'way', id: 10, nodes: [1, 2] },
            { type: 'way', id: 11, nodes: [8, 9] },
            { type: 'way', id: 12, nodes: [0, 1] },
            {
                type: 'relation', id: 20, tags: { type: 'route' },
                members: [
                    { type: 'way', ref: 10, role: '' },
                    { type: 'way', ref: 11, role: '' },
                    { type: 'way', ref: 12, role: '' },
                ],
            },
        ]);
        const geometry = result.features.find((f: any) => f.id === 'relation/20').geometry;
        expect(geometry.type).toBe('MultiLineString');
        expect(geometry.coordinates).toHaveLength(2);
        const stitched = geometry.coordinates.find((line: number[][]) => line.length === 3);
        expect(stitched).toBeDefined();
        expect(stitched).toEqual(expect.arrayContaining([[0, 0], [1, 0], [2, 0]]));
    });

    it('stitches a later member whose first point joins the head', () => {
        const result = json([
            { type: 'node', id: 0, lat: 0, lon: 0 },
            { type: 'node', id: 1, lat: 0, lon: 1 },
            { type: 'node', id: 2, lat: 0, lon: 2 },
            { type: 'node', id: 8, lat: 5, lon: 5 },
            { type: 'node', id: 9, lat: 5, lon: 6 },
            { type: 'way', id: 10, nodes: [1, 2] },
            { type: 'way', id: 11, nodes: [8, 9] },
            { type: 'way', id: 12, nodes: [1, 0] },
            {
                type: 'relation', id: 20, tags: { type: 'route' },
                members: [
                    { type: 'way', ref: 10, role: '' },
                    { type: 'way', ref: 11, role: '' },
                    { type: 'way', ref: 12, role: '' },
                ],
            },
        ]);
        const geometry = result.features.find((f: any) => f.id === 'relation/20').geometry;
        expect(geometry.coordinates).toHaveLength(2);
        const stitched = geometry.coordinates.find((line: number[][]) => line.length === 3);
        expect(stitched).toBeDefined();
        expect(stitched).toEqual(expect.arrayContaining([[0, 0], [1, 0], [2, 0]]));
    });
});

describe('deep relation chains', () => {
    it('flattens a 20,000-level relation chain without overflowing the stack', () => {
        const elements: any[] = [
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'path' } },
            { type: 'relation', id: 4, members: [{ type: 'way', ref: 3, role: '' }] },
        ];
        for (let id = 5; id <= 20000; id++) {
            elements.push({
                type: 'relation', id,
                members: [{ type: 'relation', ref: id - 1, role: '' }],
            });
        }
        const result = json(elements);
        const feature = result.features.find((f: any) => f.id === 'relation/20000');
        expect(feature).toBeDefined();
        expect(feature.geometry).toEqual({
            type: 'MultiLineString',
            coordinates: [[[0, 0], [1, 1]]],
        });
    });
});

describe('large multipolygon inner-ring assignment', () => {
    it('assigns every inner ring to its containing outer ring', () => {
        const elements: any[] = [];
        const members: any[] = [];
        let nodeId = 1;
        let wayId = 1000;

        const addSquare = (offset: number, inner: boolean) => {
            const coords = inner
                ? [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]
                : [[0, 0], [1, 0], [1, 1], [0, 1]];
            const ids = coords.map(([x, y]) => {
                const id = nodeId++;
                elements.push({ type: 'node', id, lat: y + offset, lon: x + offset });
                return id;
            });
            elements.push({ type: 'way', id: wayId, nodes: [...ids, ids[0]] });
            members.push({ type: 'way', ref: wayId, role: inner ? 'inner' : 'outer' });
            wayId++;
        };

        for (let i = 0; i < 20; i++) {
            const offset = i * 2;
            addSquare(offset, false);
            addSquare(offset, true);
        }
        elements.push({ type: 'relation', id: 1, tags: { type: 'multipolygon' }, members });

        const result = json(elements);
        const feature = result.features.find((f: any) => f.id === 'relation/1');
        expect(feature.geometry.type).toBe('MultiPolygon');
        expect(feature.geometry.coordinates).toHaveLength(20);
        for (const polygon of feature.geometry.coordinates) {
            expect(polygon).toHaveLength(2);
        }
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

describe('Overpass custom derived XML types (#34)', () => {
    it('converts an arbitrary root element with vertices and tags', () => {
        const xml = '<osm><this_string_is_user_defined id="1"><vertex lat="51.4772755" lon="0.0041914"/><vertex lat="51.4768181" lon="0.0026436"/><tag k="highway" v="pedestrian"/></this_string_is_user_defined></osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        const feature = result.features.find((f: any) => f.id === 'this_string_is_user_defined/1');
        expect(feature).toBeDefined();
        expect(feature.geometry).toEqual({
            type: 'LineString',
            coordinates: [[0.0041914, 51.4772755], [0.0026436, 51.4768181]],
        });
        expect(feature.properties.highway).toBe('pedestrian');
    });

    it('converts arbitrary root elements with point and linestring children', () => {
        const xml = '<osm>'
            + '<custom_point id="1"><point lat="2" lon="3"/></custom_point>'
            + '<custom_polygon id="2"><linestring><vertex lat="0" lon="0"/><vertex lat="0" lon="1"/><vertex lat="1" lon="0"/><vertex lat="0" lon="0"/></linestring></custom_polygon>'
            + '</osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features.find((f: any) => f.id === 'custom_point/1').geometry)
            .toEqual({ type: 'Point', coordinates: [3, 2] });
        expect(result.features.find((f: any) => f.id === 'custom_polygon/2').geometry)
            .toEqual({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] });
    });

    it('keeps custom and regular elements in mixed XML output', () => {
        const xml = '<osm>'
            + '<custom_way id="1"><vertex lat="0" lon="0"/><vertex lat="1" lon="1"/></custom_way>'
            + '<node id="2" lat="5" lon="6"><tag k="barrier" v="gate"/></node>'
            + '</osm>';
        const result = osm2geojson(xml, { completeFeature: true }) as any;
        expect(result.features.find((f: any) => f.id === 'custom_way/1')).toBeDefined();
        expect(result.features.find((f: any) => f.id === 'node/2').geometry)
            .toEqual({ type: 'Point', coordinates: [6, 5] });
    });

    it('converts arbitrary JSON element types carrying a geometry', () => {
        const result = json([{
            type: 'this_string_is_user_defined',
            id: 1,
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            tags: { highway: 'pedestrian' },
        }]);
        const feature = result.features[0];
        expect(feature.id).toBe('this_string_is_user_defined/1');
        expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(feature.properties.highway).toBe('pedestrian');
    });
});

describe('circular relations (#36)', () => {
    const data = {
        elements: [
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            {
                type: 'relation', id: 3, tags: { name: 'Relation 1' },
                members: [
                    { type: 'way', ref: 4, role: 'role1', nodes: [1, 2, 3] },
                    { type: 'relation', ref: 5, role: 'outer' },
                ],
            },
            {
                type: 'relation', id: 5, tags: { name: 'Relation 2' },
                members: [{ type: 'relation', ref: 3, role: 'inner' }],
            },
        ],
    };

    it('emits a feature for a closed relation cycle instead of nothing', () => {
        const result = json(data.elements);
        expect(result.features.length).toBeGreaterThan(0);
        expect(result.features.some((f: any) => f.id === 'relation/3')).toBe(true);
    });

    it('does not recurse forever when tagged relations are rendered', () => {
        let result: any;
        expect(() => { result = json(data.elements, { renderTagged: true }); }).not.toThrow();
        expect(result.features.some((f: any) => f.id === 'relation/3')).toBe(true);
    });

    it('handles a self-referencing relation', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'path' } },
            {
                type: 'relation', id: 4, tags: { name: 'self' },
                members: [
                    { type: 'way', ref: 3, role: '' },
                    { type: 'relation', ref: 4, role: '' },
                ],
            },
        ]);
        expect(result.features.some((f: any) => f.id === 'relation/4')).toBe(true);
    });
});
