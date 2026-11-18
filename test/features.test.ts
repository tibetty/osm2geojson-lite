/**
 * Synthetic documents, one rule each; `test/data` holds the real captures and
 * `test/support/osm-document.ts` states the provenance rule.
 */
import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';
import { assertValidOsmDocument } from './support/osm-document';

const json = (elements: any[], opts?: any) => {
    assertValidOsmDocument(elements, 'features.test.ts');
    return osm2geojson({ elements }, { completeFeature: true, ...opts }) as any;
};

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
            const offset = i * 2 - 50;
            addSquare(offset, false);
            addSquare(offset, true);
        }
        // This inner ring is outside every outer ring and must be left unassigned.
        addSquare(80, true);
        elements.push({ type: 'relation', id: 1, tags: { type: 'multipolygon' }, members });

        const result = json(elements);
        const feature = result.features.find((f: any) => f.id === 'relation/1');
        expect(feature.geometry.type).toBe('MultiPolygon');
        expect(feature.geometry.coordinates).toHaveLength(20);
        let ringCount = 0;
        for (const polygon of feature.geometry.coordinates) {
            expect(polygon.length).toBeLessThanOrEqual(2);
            ringCount += polygon.length;
        }
        expect(ringCount).toBe(40);
    });
});

// Constructed, not captured: real relations rarely nest, which is why #138
// needs this shape. It follows the Baarle enclaves (rel/47798, rel/53137), but
// no real relation contains the nesting that broke it.
describe('nested island inner rings (#138)', () => {
    const square = (min: number, max: number) => [
        { lat: min, lon: min }, { lat: min, lon: max },
        { lat: max, lon: max }, { lat: max, lon: min }, { lat: min, lon: min },
    ];

    const nested = (order: number[]) => ({
        elements: [{
            type: 'relation', id: 1, tags: { type: 'multipolygon', natural: 'wood' },
            members: order.map((n) => ({ type: 'way', ref: n, role: n % 2 === 0 ? 'outer' : 'inner', geometry: square(n === 10 ? 0 : n === 11 ? 1 : n === 12 ? 2 : 3, n === 10 ? 7 : n === 11 ? 6 : n === 12 ? 5 : 4) })),
        }],
    });

    const bbox = (ring: number[][]) => ring.reduce(
        ([minX, minY, maxX, maxY], [x, y]) => [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)],
        [Infinity, Infinity, -Infinity, -Infinity],
    );

    const geometryOf = (elements: any) => (json(elements.elements) as any).features.find((f: any) => f.id === 'relation/1').geometry;

    it('assigns an island hole to the island, not to the outermost ring', () => {
        const geometry = geometryOf(nested([10, 11, 12, 13]));
        expect(geometry.type).toBe('MultiPolygon');
        expect(geometry.coordinates).toHaveLength(2);
        const [outer, island] = geometry.coordinates;
        expect(outer).toHaveLength(2);
        expect(island).toHaveLength(2);
        expect(bbox(outer[0])).toEqual([0, 0, 7, 7]);
        expect(bbox(outer[1])).toEqual([1, 1, 6, 6]);
        expect(bbox(island[0])).toEqual([2, 2, 5, 5]);
        expect(bbox(island[1])).toEqual([3, 3, 4, 4]);
    });

    it('does not depend on member order', () => {
        // Polygons are emitted in outer-ring order, so compare the assignment
        // itself: each outer with its holes, sorted, independent of member order.
        const assignment = (elements: any) => geometryOf(elements).coordinates
            .map((polygon: number[][][]) => polygon.map((ring) => bbox(ring).join(',')))
            .sort();
        expect(assignment(nested([12, 13, 10, 11]))).toEqual(assignment(nested([10, 11, 12, 13])));
        expect(assignment(nested([10, 13, 12, 11]))).toEqual(assignment(nested([10, 11, 12, 13])));
    });

    it('settles overlapping outers deterministically when neither contains the other', () => {
        // Two outers overlap without nesting, so containment cannot order them:
        // the smaller bounding box wins, and member order must not matter.
        const big = square(0, 10);
        const small = square(5, 12);
        const hole = [{ lat: 6, lon: 6 }, { lat: 6, lon: 7 }, { lat: 7, lon: 7 }, { lat: 7, lon: 6 }, { lat: 6, lon: 6 }];
        const geometryFor = (order: number[]) => geometryOf({
            elements: [{
                type: 'relation', id: 1, tags: { type: 'multipolygon' },
                members: order.map((ref) => ({ type: 'way', ref, role: ref === 1 ? 'inner' : 'outer', geometry: ref === 1 ? hole : ref === 2 ? big : small })),
            }],
        });
        const described = (geometry: any) => geometry.coordinates
            .map((polygon: number[][][]) => polygon.map((ring) => bbox(ring).join(',')).join(' | '))
            .sort();
        expect(described(geometryFor([1, 2, 3]))).toEqual(described(geometryFor([1, 3, 2])));
        // The hole belongs to the 5..12 outer, whose bounds are the smaller.
        const withHole = geometryFor([1, 2, 3]).coordinates
            .filter((polygon: number[][][]) => polygon.length === 2)
            .map((polygon: number[][][]) => polygon.map((ring) => bbox(ring).join(',')));
        expect(withHole).toEqual([['5,5,12,12', '6,6,7,7']]);
    });

    it('picks the innermost ring through the grid path as well', () => {
        // 17 nested outers x 17 inner rings = 289 pairs, above the 256 cutoff
        // that switches linkInnerRings to the uniform grid.
        const members: any[] = [];
        const squareRing = (min: number, max: number) => [
            { lat: min, lon: min }, { lat: min, lon: max },
            { lat: max, lon: max }, { lat: max, lon: min }, { lat: min, lon: min },
        ];
        // Shifted into the valid coordinate range: the shape is invented, but
        // OSM could carry it, so the document stays inside the data model.
        for (let k = 0; k < 17; k++) {
            members.push({ type: 'way', ref: 100 + k, role: 'outer', geometry: squareRing(k - 50, 50 - k) });
            members.push({ type: 'way', ref: 200 + k, role: 'inner', geometry: squareRing(k - 50 + 0.25, 50 - k - 0.25) });
        }
        const geometry = geometryOf({ elements: [{ type: 'relation', id: 1, tags: { type: 'multipolygon' }, members }] });
        expect(geometry.type).toBe('MultiPolygon');
        expect(geometry.coordinates).toHaveLength(17);
        for (let k = 0; k < 17; k++) {
            const polygon = geometry.coordinates[k];
            expect(polygon).toHaveLength(2);
            expect(bbox(polygon[0])).toEqual([k - 50, k - 50, 50 - k, 50 - k]);
            expect(bbox(polygon[1])).toEqual([k - 49.75, k - 49.75, 49.75 - k, 49.75 - k]);
        }
    });
});

describe('relation flattening corner cases', () => {
    it('handles a three-relation cycle', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'path' } },
            {
                type: 'relation', id: 4, tags: { type: 'route' },
                members: [
                    { type: 'way', ref: 3, role: '' },
                    { type: 'relation', ref: 5, role: '' },
                ],
            },
            { type: 'relation', id: 5, members: [{ type: 'relation', ref: 6, role: '' }] },
            { type: 'relation', id: 6, members: [{ type: 'relation', ref: 4, role: '' }] },
        ]);
        const feature = result.features.find((f: any) => f.id === 'relation/4');
        expect(feature).toBeDefined();
        expect(feature.geometry.type).toBe('MultiLineString');
    });

    it('preserves a way shared by different sub-relations', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'path' } },
            { type: 'relation', id: 4, members: [{ type: 'way', ref: 3, role: '' }] },
            { type: 'relation', id: 5, members: [{ type: 'way', ref: 3, role: '' }] },
            {
                type: 'relation', id: 6,
                members: [
                    { type: 'relation', ref: 4, role: '' },
                    { type: 'relation', ref: 5, role: '' },
                ],
            },
        ]);
        const feature = result.features.find((f: any) => f.id === 'relation/6');
        expect(feature.geometry.type).toBe('MultiLineString');
        // The collector keeps both contributions; the stitcher joins the
        // shared way into a single line that traverses it twice.
        expect(feature.geometry.coordinates).toEqual([[[0, 0], [1, 1], [0, 0]]]);
    });

    it('marks a relation tainted when a sub-relation is missing', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'path' } },
            {
                type: 'relation', id: 4, tags: { type: 'route' },
                members: [
                    { type: 'way', ref: 3, role: '' },
                    { type: 'relation', ref: 999, role: '' },
                ],
            },
        ], { tainted: true });
        const feature = result.features.find((f: any) => f.id === 'relation/4');
        expect(feature).toBeDefined();
        expect(feature.properties['@tainted']).toBe(true);
    });
});

describe('OSM relation type semantics', () => {
    const ring = [
        { type: 'node', id: 1, lat: 0, lon: 0 },
        { type: 'node', id: 2, lat: 0, lon: 1 },
        { type: 'node', id: 3, lat: 1, lon: 1 },
        { type: 'node', id: 4, lat: 1, lon: 0 },
        { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes' } },
    ];

    it('treats an empty role as outer for multipolygon and boundary relations', () => {
        for (const tags of [
            { type: 'multipolygon', name: 'area' },
            { type: 'boundary', boundary: 'administrative', name: 'area' },
        ]) {
            const result = json([
                ...ring,
                { type: 'relation', id: 20, tags, members: [{ type: 'way', ref: 10, role: '' }] },
            ]);
            const feature = result.features.find((f: any) => f.id === 'relation/20');
            expect(feature).toBeDefined();
            expect(feature.geometry.type).toBe('Polygon');
        }
    });

    it('attributes old-style multipolygons to the tagged outer way', () => {
        const result = json([
            ...ring,
            { type: 'relation', id: 20, tags: { type: 'multipolygon' }, members: [{ type: 'way', ref: 10, role: 'outer' }] },
        ]);
        const feature = result.features.find((f: any) => f.id === 'way/10');
        expect(feature).toBeDefined();
        expect(feature.properties.building).toBe('yes');
        expect(feature.geometry.type).toBe('Polygon');
        expect(result.features.some((f: any) => f.id === 'relation/20')).toBe(false);
    });

    it('does not turn restriction relations into a geometry feature', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 0 },
            { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
            { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'service' } },
            {
                type: 'relation', id: 20, tags: { type: 'restriction', restriction: 'no_left_turn' },
                members: [
                    { type: 'way', ref: 10, role: 'from' },
                    { type: 'node', ref: 2, role: 'via' },
                    { type: 'way', ref: 11, role: 'to' },
                ],
            },
        ]);
        expect(result.features.some((f: any) => f.id === 'relation/20')).toBe(false);
        expect(result.features.some((f: any) => f.id === 'way/10')).toBe(true);
        expect(result.features.some((f: any) => f.id === 'way/11')).toBe(true);
    });

    it('does not turn site relations into a single geometry feature', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0, tags: { tourism: 'museum' } },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 0 },
            { type: 'way', id: 10, nodes: [2, 3], tags: { building: 'yes' } },
            {
                type: 'relation', id: 20, tags: { type: 'site', site: 'museum' },
                members: [
                    { type: 'node', ref: 1, role: '' },
                    { type: 'way', ref: 10, role: '' },
                ],
            },
        ]);
        expect(result.features.some((f: any) => f.id === 'relation/20')).toBe(false);
        expect(result.features.some((f: any) => f.id === 'node/1')).toBe(true);
        expect(result.features.some((f: any) => f.id === 'way/10')).toBe(true);
    });

    it('does not merge route_master relations into one geometry', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
            { type: 'relation', id: 25, tags: { type: 'route', route: 'bus' }, members: [{ type: 'way', ref: 10, role: '' }] },
            { type: 'relation', id: 26, tags: { type: 'route_master', route_master: 'bus' }, members: [{ type: 'relation', ref: 25, role: '' }] },
        ]);
        expect(result.features.some((f: any) => f.id === 'relation/26')).toBe(false);
        expect(result.features.some((f: any) => f.id === 'relation/25')).toBe(true);
    });
});

describe('old-style multipolygons', () => {
    it('emits the tagged outer way once, without a relation feature', () => {
        // 2.3.0 attributed the feature to the outer way but also let the
        // relation re-emit it, so the same id appeared twice until 2.7.2.
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 1], tags: { natural: 'water' } },
            { type: 'relation', id: 20, tags: { type: 'multipolygon' }, members: [{ type: 'way', ref: 10, role: 'outer' }] },
        ]);
        const ids = result.features.map((feature: any) => feature.id);
        expect(ids).toEqual(['way/10']);
        expect(result.features[0].geometry.type).toBe('Polygon');
    });
});

describe('role-aware relation members', () => {
    it('keeps route platform ways and stop nodes independent', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 0 },
            { type: 'node', id: 4, lat: 1, lon: 1 },
            { type: 'node', id: 5, lat: 5, lon: 5, tags: { highway: 'bus_stop' } },
            { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
            { type: 'way', id: 11, nodes: [3, 4], tags: { amenity: 'parking' } },
            {
                type: 'relation', id: 20, tags: { type: 'route', route: 'bus' },
                members: [
                    { type: 'way', ref: 10, role: '' },
                    { type: 'way', ref: 11, role: 'platform' },
                    { type: 'node', ref: 5, role: 'stop' },
                ],
            },
        ]);
        const route = result.features.find((f: any) => f.id === 'relation/20');
        expect(route.geometry).toEqual({
            type: 'MultiLineString',
            coordinates: [[[0, 0], [1, 0]]],
        });
        expect(result.features.some((f: any) => f.id === 'way/11')).toBe(true);
        expect(result.features.some((f: any) => f.id === 'node/5')).toBe(true);
        expect(result.features.find((f: any) => f.id === 'node/5').geometry)
            .toEqual({ type: 'Point', coordinates: [5, 5] });
    });

    it('keeps boundary subarea relations and admin_centre nodes independent', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'node', id: 4, lat: 1, lon: 0 },
            { type: 'node', id: 5, lat: 2, lon: 2 },
            { type: 'node', id: 6, lat: 2, lon: 3 },
            { type: 'node', id: 7, lat: 3, lon: 3 },
            { type: 'node', id: 8, lat: 3, lon: 2 },
            { type: 'node', id: 12, lat: 9, lon: 9, tags: { place: 'town' } },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
            { type: 'way', id: 11, nodes: [5, 6, 7, 8, 5] },
            {
                type: 'relation', id: 13, tags: { type: 'boundary', boundary: 'administrative', name: 'child' },
                members: [{ type: 'way', ref: 11, role: 'outer' }],
            },
            {
                type: 'relation', id: 20, tags: { type: 'boundary', boundary: 'administrative', name: 'parent' },
                members: [
                    { type: 'way', ref: 10, role: 'outer' },
                    { type: 'relation', ref: 13, role: 'subarea' },
                    { type: 'node', ref: 12, role: 'admin_centre' },
                ],
            },
        ]);
        const parent = result.features.find((f: any) => f.id === 'relation/20');
        expect(parent.geometry.type).toBe('Polygon');
        expect(parent.geometry.coordinates[0]).toHaveLength(5);
        expect(result.features.some((f: any) => f.id === 'relation/13')).toBe(true);
        expect(result.features.some((f: any) => f.id === 'node/12')).toBe(true);
    });

    it('does not absorb polygon way members with non-geometric roles', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'node', id: 4, lat: 1, lon: 0 },
            { type: 'node', id: 5, lat: 5, lon: 5 },
            { type: 'node', id: 6, lat: 5, lon: 6 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
            { type: 'way', id: 11, nodes: [5, 6], tags: { highway: 'path' } },
            {
                type: 'relation', id: 20, tags: { type: 'multipolygon', name: 'area' },
                members: [
                    { type: 'way', ref: 10, role: 'outer' },
                    { type: 'way', ref: 11, role: 'subarea' },
                ],
            },
        ]);
        const area = result.features.find((f: any) => f.id === 'relation/20');
        expect(area.geometry.type).toBe('Polygon');
        expect(area.geometry.coordinates[0]).toHaveLength(5);
        expect(result.features.some((f: any) => f.id === 'way/11')).toBe(true);
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

describe('ring stitching', () => {
    const square = (base: number, x: number, y: number) => [
        { type: 'node', id: base + 1, lat: y, lon: x },
        { type: 'node', id: base + 2, lat: y, lon: x - 1 },
        { type: 'node', id: base + 3, lat: y - 1, lon: x - 1 },
        { type: 'node', id: base + 4, lat: y - 1, lon: x },
    ];

    it('keeps two outer rings that touch at one node as separate polygons', () => {
        // Synthetic: two closed outer ways sharing the corner node 1 (1,1).
        const result = json([
            ...square(0, 1, 1),
            { type: 'node', id: 5, lat: 1, lon: 2 },
            { type: 'node', id: 6, lat: 2, lon: 2 },
            { type: 'node', id: 7, lat: 2, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
            { type: 'way', id: 11, nodes: [1, 5, 6, 7, 1] },
            { type: 'relation', id: 100, tags: { type: 'multipolygon', landuse: 'grass' }, members: [
                { type: 'way', ref: 10, role: 'outer' },
                { type: 'way', ref: 11, role: 'outer' },
            ] },
        ]);
        const relation = result.features.find((f: any) => f.id === 'relation/100');
        expect(relation.geometry.type).toBe('MultiPolygon');
        expect(relation.geometry.coordinates).toHaveLength(2);
        for (const polygon of relation.geometry.coordinates) {
            expect(polygon).toHaveLength(1);
            expect(polygon[0]).toHaveLength(5);
        }
    });

    it('flags a polygon relation whose outer ring does not close', () => {
        const elements = [
            ...square(0, 1, 1),
            ...square(10, 5, 5),
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
            { type: 'way', id: 11, nodes: [11, 12, 13, 14] },
            { type: 'relation', id: 100, tags: { type: 'multipolygon', landuse: 'grass' }, members: [
                { type: 'way', ref: 10, role: 'outer' },
                { type: 'way', ref: 11, role: 'outer' },
            ] },
        ];
        const relation = json(elements, { tainted: true }).features.find((f: any) => f.id === 'relation/100');
        expect(relation.geometry.type).toBe('Polygon');
        expect(relation.properties['@tainted']).toBe(true);
        expect(json(elements).features.find((f: any) => f.id === 'relation/100').properties['@tainted']).toBeUndefined();
    });

    it('flags a polygon relation whose inner ring lies outside every outer ring', () => {
        const relation = json([
            ...square(0, 1, 1),
            ...square(10, 5, 5),
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] },
            { type: 'way', id: 11, nodes: [11, 12, 13, 14, 11] },
            { type: 'relation', id: 100, tags: { type: 'multipolygon', landuse: 'grass' }, members: [
                { type: 'way', ref: 10, role: 'outer' },
                { type: 'way', ref: 11, role: 'inner' },
            ] },
        ], { tainted: true }).features.find((f: any) => f.id === 'relation/100');
        expect(relation.geometry).toMatchObject({ type: 'Polygon' });
        expect(relation.geometry.coordinates).toHaveLength(1);
        expect(relation.properties['@tainted']).toBe(true);
    });
});

describe('closed way polygon rules', () => {
    const closed = (tags: Record<string, string>) => json([
        { type: 'node', id: 1, lat: 0, lon: 0 },
        { type: 'node', id: 2, lat: 0, lon: 1 },
        { type: 'node', id: 3, lat: 1, lon: 1 },
        { type: 'way', id: 10, nodes: [1, 2, 3, 1], tags },
    ]).features[0].geometry.type;

    it('is an area when any polygon tag applies, whatever the rule order', () => {
        // Monaco has `amenity=fountain` + `barrier=kerb` (way/572947839); the
        // later `barrier` rule used to overwrite the earlier `amenity` match.
        expect(closed({ amenity: 'fountain', barrier: 'kerb' })).toBe('Polygon');
        expect(closed({ building: 'yes', highway: 'footway' })).toBe('Polygon');
        expect(closed({ highway: 'footway' })).toBe('LineString');
    });

    it('lets area=no opt out of every other rule', () => {
        expect(closed({ building: 'yes', area: 'no' })).toBe('LineString');
        expect(closed({ highway: 'pedestrian', area: 'yes' })).toBe('Polygon');
    });
});

describe('old-style multipolygon taint', () => {
    it('does not leak the relation taint onto the outer way feature', () => {
        // The inner member is missing, so the relation is tainted; the way
        // itself is complete.
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 10 },
            { type: 'node', id: 3, lat: 10, lon: 10 },
            { type: 'node', id: 4, lat: 10, lon: 0 },
            { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { landuse: 'forest' } },
            { type: 'relation', id: 100, tags: { type: 'multipolygon' }, members: [
                { type: 'way', ref: 10, role: 'outer' },
                { type: 'way', ref: 999, role: 'inner' },
            ] },
        ], { renderTagged: true, excludeWay: false, tainted: true });
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.properties['@tainted']).toBeUndefined();
    });
});
