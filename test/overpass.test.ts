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
});
