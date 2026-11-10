import { describe, expect, it } from 'vitest';
import osm2geojson from '../src/index';

const json = (elements: any[], opts?: any) => osm2geojson({ elements }, { completeFeature: true, ...opts }) as any;
const xml = (source: string, opts?: any) => osm2geojson(source, { completeFeature: true, ...opts }) as any;

describe('Overpass output modes', () => {
    it('does not invent points for out ids/out tags nodes without coordinates', () => {
        expect(json([{ type: 'node', id: 1 }]).features).toEqual([]);
        expect(json([{ type: 'node', id: 2, tags: { name: 'tag-only' } }]).features).toEqual([]);
        expect(xml('<osm><node id="3"><tag k="name" v="tag-only"/></node></osm>').features).toEqual([]);
    });

    it('does not invent features for geometry-less ways/relations', () => {
        expect(json([{ type: 'way', id: 1, tags: { highway: 'path' } }]).features).toEqual([]);
        expect(json([{ type: 'relation', id: 2, tags: { type: 'route' } }]).features).toEqual([]);
    });

    it('skips null entries in out geom way geometry', () => {
        const data = [{
            type: 'way', id: 1, tags: { highway: 'path' },
            geometry: [{ lat: 0, lon: 0 }, null, { lat: 1, lon: 1 }],
        }];
        const result = json(data);
        expect(result.features[0].geometry).toEqual({
            type: 'LineString',
            coordinates: [[0, 0], [1, 1]],
        });
        expect(result.features[0].properties['@tainted']).toBeUndefined();
        expect(json(data, { tainted: true }).features[0].properties['@tainted']).toBe(true);
    });

    it('skips null entries in relation member geometry and marks the relation tainted', () => {
        const data = [{
            type: 'relation', id: 2, tags: { type: 'route' },
            members: [{
                type: 'way', ref: 3, role: '',
                geometry: [{ lat: 0, lon: 0 }, null, { lat: 1, lon: 1 }],
            }],
        }];
        const result = json(data);
        const feature = result.features.find((f: any) => f.id === 'relation/2');
        expect(feature.geometry).toEqual({
            type: 'MultiLineString',
            coordinates: [[[0, 0], [1, 1]]],
        });
        expect(feature.properties['@tainted']).toBeUndefined();
        expect(json(data, { tainted: true }).features.find((f: any) => f.id === 'relation/2').properties['@tainted']).toBe(true);
    });

    it('marks a way and its parent relation tainted when a node has no coordinates', () => {
        const data = [
            { type: 'node', id: 1, tags: { name: 'no-coords' } },
            { type: 'node', id: 2, lat: 0, lon: 0 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'way', id: 4, nodes: [1, 2, 3], tags: { highway: 'path' } },
            { type: 'relation', id: 5, tags: { type: 'route' }, members: [{ type: 'way', ref: 4, role: '' }] },
        ];
        const result = json(data, { tainted: true, renderTagged: true, excludeWay: false });
        const way = result.features.find((f: any) => f.id === 'way/4');
        const relation = result.features.find((f: any) => f.id === 'relation/5');
        expect(way.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(way.properties['@tainted']).toBe(true);
        expect(relation.properties['@tainted']).toBe(true);
    });

    it('keeps out meta relation attributes in XML', () => {
        const source = '<osm><relation id="9" version="3" timestamp="2026-01-01T00:00:00Z" changeset="7" user="alice" uid="1">'
            + '<bounds minlat="0" minlon="0" maxlat="1" maxlon="1"/>'
            + '<tag k="type" v="route"/>'
            + '</relation></osm>';
        const feature = xml(source).features.find((f: any) => f.id === 'relation/9');
        expect(feature.properties).toMatchObject({
            version: '3',
            timestamp: '2026-01-01T00:00:00Z',
            changeset: '7',
            user: 'alice',
            uid: '1',
            type: 'route',
        });
        expect(feature.geometry).toEqual({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        });
    });

    it('joins across null entries at the start and end (documented behavior)', () => {
        const start = json([{
            type: 'way', id: 1, tags: { highway: 'path' },
            geometry: [null, { lat: 0, lon: 0 }, { lat: 1, lon: 1 }],
        }], { tainted: true });
        expect(start.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(start.features[0].properties['@tainted']).toBe(true);

        const end = json([{
            type: 'way', id: 2, tags: { highway: 'path' },
            geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, null],
        }], { tainted: true });
        expect(end.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(end.features[0].properties['@tainted']).toBe(true);
    });

    it('does not emit a way when every geometry entry is null', () => {
        expect(json([{
            type: 'way', id: 1, tags: { highway: 'path' },
            geometry: [null, null],
        }]).features).toEqual([]);
    });

    it('skips multiple consecutive null entries', () => {
        const result = json([{
            type: 'way', id: 1, tags: { highway: 'path' },
            geometry: [{ lat: 0, lon: 0 }, null, null, { lat: 1, lon: 1 }],
        }], { tainted: true });
        expect(result.features[0].geometry).toEqual({
            type: 'LineString',
            coordinates: [[0, 0], [1, 1]],
        });
        expect(result.features[0].properties['@tainted']).toBe(true);
    });

    it('does not emit a way with only one usable point', () => {
        expect(json([{
            type: 'way', id: 1, tags: { highway: 'path' },
            geometry: [{ lat: 0, lon: 0 }, null],
        }]).features).toEqual([]);
    });

    it('ignores CDATA content instead of parsing it as markup', () => {
        const source = '<osm><![CDATA[<node id="999" lat="0" lon="0"/>]]><node id="1" lat="5" lon="6"/></osm>';
        const features = xml(source).features;
        expect(features).toHaveLength(1);
        expect(features[0].id).toBe('node/1');
        expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [6, 5] });
    });
});

describe('coordinate validation', () => {
    it('skips invalid derived XML coordinates and marks the output tainted', () => {
        const source = '<osm><way id="1"><tag k="highway" v="path"/>'
            + '<vertex lat="0" lon="0"/><vertex lat="bad" lon="1"/><vertex lat="1" lon="1"/>'
            + '</way></osm>';
        const result = xml(source, { tainted: true });
        expect(result.features[0].geometry).toEqual({
            type: 'LineString',
            coordinates: [[0, 0], [1, 1]],
        });
        expect(result.features[0].properties['@tainted']).toBe(true);
    });

    it('ignores invalid bounds and centers', () => {
        const jsonWay = json([{
            type: 'way', id: 1, tags: { highway: 'path' },
            center: { lat: 'bad', lon: 0 },
            bounds: { minlat: 'bad', minlon: 0, maxlat: 1, maxlon: 1 },
        }], { tainted: true });
        expect(jsonWay.features).toEqual([]);

        const jsonRelation = json([{
            type: 'relation', id: 2, tags: { type: 'route' },
            center: { lat: Number.NaN, lon: 0 },
        }], { tainted: true });
        expect(jsonRelation.features).toEqual([]);

        const xmlWay = xml('<osm><way id="1"><center lat="bad" lon="0"/>'
            + '<bounds minlat="bad" minlon="0" maxlat="1" maxlon="1"/></way></osm>', { tainted: true });
        expect(xmlWay.features).toEqual([]);
    });

    it('passes explicit JSON geometry objects through unchanged', () => {
        const geometry = { type: 'Point', coordinates: [Number.NaN, Number.NaN] };
        const result = json([{ type: 'custom', id: 1, geometry }]);
        expect(result.features[0].geometry).toEqual(geometry);
    });

    it('marks a relation tainted when bounds/center are invalid but members provide geometry', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
            { type: 'way', id: 3, nodes: [1, 2] },
            {
                type: 'relation', id: 4, tags: { type: 'route' },
                bounds: { minlat: 'bad', minlon: 0, maxlat: 1, maxlon: 1 },
                center: { lat: 'bad', lon: 0 },
                members: [{ type: 'way', ref: 3, role: '' }],
            },
        ], { tainted: true });
        const relation = result.features.find((f: any) => f.id === 'relation/4');
        expect(relation).toBeDefined();
        expect(relation.properties['@tainted']).toBe(true);
    });

    it('marks a derived linestring with an invalid vertex tainted', () => {
        const source = '<osm><relation id="1"><tag k="type" v="multipolygon"/>'
            + '<linestring><vertex lat="0" lon="0"/><vertex lat="bad" lon="1"/>'
            + '<vertex lat="1" lon="1"/><vertex lat="0" lon="0"/></linestring>'
            + '</relation></osm>';
        const feature = xml(source, { tainted: true }).features[0];
        expect(feature.geometry.type).toBe('Polygon');
        expect(feature.properties['@tainted']).toBe(true);
    });
});

describe('duplicate input elements', () => {
    it('merges a geometry copy and a tags copy of the same way', () => {
        const result = json([
            { type: 'way', id: 1, nodes: [1, 2] },
            { type: 'way', id: 1, tags: { highway: 'path' }, version: 2 },
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
        ]);
        const feature = result.features.find((f: any) => f.id === 'way/1');
        expect(feature).toBeDefined();
        expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(feature.properties.highway).toBe('path');
    });

    it('merges a tags copy and a geometry copy regardless of order', () => {
        const result = json([
            { type: 'way', id: 1, tags: { highway: 'path' }, version: 2 },
            { type: 'way', id: 1, nodes: [1, 2] },
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 1, lon: 1 },
        ]);
        const feature = result.features.find((f: any) => f.id === 'way/1');
        expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(feature.properties.highway).toBe('path');
    });

    it('keeps the newest version and fills missing tags from older copies', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0, tags: { name: 'old', amenity: 'cafe' }, version: 1 },
            { type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'new' }, version: 2 },
        ]);
        const feature = result.features[0];
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [1, 1] });
        expect(feature.properties).toMatchObject({ name: 'new', amenity: 'cafe', version: 2 });
    });

    it('merges XML duplicate ways with geometry and tags', () => {
        const geometryFirst = '<osm><node id="1" lat="0" lon="0"/><node id="2" lat="1" lon="1"/>'
            + '<way id="1"><nd ref="1"/><nd ref="2"/></way>'
            + '<way id="1" version="2"><tag k="highway" v="path"/></way></osm>';
        const tagsFirst = '<osm><node id="1" lat="0" lon="0"/><node id="2" lat="1" lon="1"/>'
            + '<way id="1" version="2"><tag k="highway" v="path"/></way>'
            + '<way id="1"><nd ref="1"/><nd ref="2"/></way></osm>';
        for (const source of [geometryFirst, tagsFirst]) {
            const feature = xml(source).features.find((f: any) => f.id === 'way/1');
            expect(feature).toBeDefined();
            expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
            expect(feature.properties.highway).toBe('path');
        }
    });

    it('merges XML duplicate node versions', () => {
        const source = '<osm>'
            + '<node id="1" version="1" lat="0" lon="0"><tag k="name" v="old"/><tag k="amenity" v="cafe"/></node>'
            + '<node id="1" version="2" lat="1" lon="1"><tag k="name" v="new"/></node>'
            + '</osm>';
        const feature = xml(source).features[0];
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [1, 1] });
        expect(feature.properties).toMatchObject({ name: 'new', amenity: 'cafe', version: '2' });
    });
});

describe('XML scanner corner cases', () => {
    it('ignores comments containing markup', () => {
        const source = '<osm><!-- <node id="999" lat="0" lon="0"/> --><node id="1" lat="5" lon="6"/></osm>';
        const features = xml(source).features;
        expect(features).toHaveLength(1);
        expect(features[0].id).toBe('node/1');
    });

    it('ignores unknown wrapper subtrees', () => {
        const source = '<osm><wrapper><node id="999" lat="0" lon="0"/></wrapper><node id="1" lat="5" lon="6"/></osm>';
        const features = xml(source).features;
        expect(features).toHaveLength(1);
        expect(features[0].id).toBe('node/1');
    });

    it('allows ">" inside quoted attribute values', () => {
        const source = '<osm><node id="1" lat="5" lon="6"><tag k="note" v="a>b"/></node></osm>';
        const feature = xml(source).features[0];
        expect(feature.properties.note).toBe('a>b');
    });

    it('supports derived group geometry', () => {
        const source = '<osm><node id="1"><group>'
            + '<point lat="1" lon="2"/><vertex lat="3" lon="4"/><vertex lat="5" lon="6"/>'
            + '</group></node></osm>';
        const feature = xml(source).features[0];
        expect(feature.geometry).toEqual({
            type: 'GeometryCollection',
            geometries: [
                { type: 'Point', coordinates: [2, 1] },
                { type: 'LineString', coordinates: [[4, 3], [6, 5]] },
            ],
        });
    });

    it('marks invalid group vertices tainted', () => {
        const source = '<osm><node id="1"><tag k="name" v="x"/><group>'
            + '<point lat="1" lon="2"/><vertex lat="bad" lon="4"/>'
            + '</group></node></osm>';
        const feature = xml(source, { tainted: true }).features[0];
        expect(feature.properties['@tainted']).toBe(true);
    });

    it('handles unterminated CDATA and truncated documents without throwing', () => {
        for (const source of [
            '<osm><![CDATA[<node id="999"/>',
            '<osm><node id="1"',
            '<osm><node id="1" lat="0" lon="0"></osm>',
            '<osm><node id="1" lat="0" lon="0"></node>',
            '</osm>',
        ]) {
            expect(() => xml(source)).not.toThrow();
        }
    });
});
