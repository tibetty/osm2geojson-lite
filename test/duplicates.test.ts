import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';

/**
 * Duplicate handling: Overpass can return the same element twice (skeleton and
 * geometry, or a derived object and a placeholder). These cases exercise every
 * branch of `RefElements` duplicate resolution, including the order-sensitive
 * ones, because the wrong binder being dropped silently loses geometry.
 */

const json = (elements: any[], opts?: any) => osm2geojson({ elements }, { completeFeature: true, ...opts }) as any;

describe('duplicate resolution', () => {
    it('drops the duplicate binders of a way that already has coordinates', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2] },
            { type: 'way', id: 10, nodes: [1, 2] },
        ]);
        expect(result.features.find((f: any) => f.id === 'way/10').geometry.coordinates).toEqual([[0, 0], [1, 0]]);
    });

    it('adopts coordinates from the newer duplicate of a way', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2] },
            { type: 'way', id: 10, version: 2, nodes: [1, 2], tags: { highway: 'path' } },
        ]);
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[0, 0], [1, 0]]);
        expect(way.properties.highway).toBe('path');
    });

    it('adopts members from the newer duplicate of a relation', () => {
        const result = json([
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'node', id: 3, lat: 1, lon: 1 },
            { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'path' } },
            { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'path' } },
            { type: 'relation', id: 20, tags: { type: 'route' } },
            { type: 'relation', id: 20, version: 2, tags: { type: 'route' }, members: [{ type: 'way', ref: 11, role: '' }] },
        ]);
        const relation = result.features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[1, 0], [1, 1]]] });
    });

    it('lets a derived duplicate replace a relation placeholder', () => {
        const result = json([
            { type: 'relation', id: 20, tags: { type: 'multipolygon' } },
            {
                type: 'relation', id: 20, tags: { type: 'multipolygon' },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
            },
        ]);
        const relation = result.features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry.type).toBe('Polygon');
    });

    it('keeps the placeholder when the duplicate has no geometry either', () => {
        const result = json([
            { type: 'relation', id: 20, tags: { type: 'route' } },
            { type: 'relation', id: 20, tags: { type: 'route' } },
        ]);
        expect(result.features.find((f: any) => f.id === 'relation/20')).toBeUndefined();
    });

    it('ignores a duplicate custom element without geometry', () => {
        const result = json([
            { type: 'count', id: 0, tags: { nodes: '1' } },
            { type: 'count', id: 0, tags: { nodes: '2' } },
        ]);
        expect(result.features).toEqual([]);
    });

    it('replaces a placeholder way with a newer coordinate copy', () => {
        const result = json([
            { type: 'way', id: 10, tags: { highway: 'path' } },
            { type: 'node', id: 1, lat: 0, lon: 0 },
            { type: 'node', id: 2, lat: 0, lon: 1 },
            { type: 'way', id: 10, version: 3, nodes: [1, 2], tags: { highway: 'path' } },
        ]);
        expect(result.features.find((f: any) => f.id === 'way/10').geometry.coordinates).toEqual([[0, 0], [1, 0]]);
    });
});
