import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import osmtogeojson from 'osmtogeojson';
import osm2geojson from '../src/index';

/**
 * Differential check against `osmtogeojson`, the reference implementation this
 * library was originally written to match.
 *
 * Feature selection is compared on every fixture; geometry is compared exactly
 * on the fixtures where the two implementations agree. Differences that come
 * from deliberate design decisions (see CHANGELOG 2.3/2.4: relations with
 * geometry are features, roles decide what is absorbed) are listed per fixture
 * so that any *new* difference fails the test, and a difference that disappears
 * fails too until the list is updated.
 */

const KNOWN_DIFFERENCES: Record<string, { oursOnly?: string[], theirsOnly?: string[], typeDifferences?: Record<string, string>, reason: string }> = {
    'original.osm': {
        oursOnly: ['way/303964442'],
        reason: 'role-aware members: subarea/other-role ways are released as independent features',
    },
    'ordered-relation.json': {
        oursOnly: ['relation/5'],
        theirsOnly: ['node/1', 'node/2', 'node/3', 'node/4'],
        reason: 'a relation with geometry is a feature; its member nodes are emitted independently',
    },
    'relation-in-relation.json': {
        oursOnly: ['relation/5', 'relation/6'],
        theirsOnly: ['node/1', 'node/2', 'node/3'],
        reason: 'super-relations produce their own feature instead of only their member nodes',
    },
    'relation-in-relation-with-ways-same-role.json': {
        oursOnly: ['relation/5', 'relation/6'],
        theirsOnly: ['node/1', 'node/2', 'node/3'],
        reason: 'super-relations produce their own feature instead of only their member nodes',
    },
    'relation-with-two-ways.json': {
        oursOnly: ['relation/6'],
        theirsOnly: ['way/5'],
        reason: 'the relation feature supersedes the way it is built from',
    },
    'super-relation-2-levels.json': {
        oursOnly: ['relation/13'],
        theirsOnly: ['way/6', 'way/7'],
        reason: 'the flattened super-relation feature supersedes its member ways',
    },
    'map.osm': {
        typeDifferences: { 'way/105582213': 'LineString/Polygon' },
        reason: 'partial extract: three of four ring nodes are missing, so we emit a tainted degenerate line where they close a degenerate polygon',
    },
    'map.json': {
        typeDifferences: { 'way/105582213': 'LineString/Polygon' },
        reason: 'partial extract: three of four ring nodes are missing, so we emit a tainted degenerate line where they close a degenerate polygon',
    },
};

/** Fixtures where both implementations must agree on coordinates, exactly. */
const STRICT = new Set([
    'node.osm', 'node.json',
    'way.osm', 'way.json', 'way2.json',
    'herne.osm', 'herne.json',
    'closed-way-not-polygon.json',
    'empty.osm', 'empty.json',
    'relation.osm', 'relation.json',
    'hydrated-way.osm',
    'hebei.osm', 'hebei.json',
    'tokyodo.osm', 'tokyodo.json',
    'usa.osm', 'usa.json',
    'zhucheng.osm', 'zhucheng.json',
]);

const opts = { completeFeature: true, renderTagged: true, excludeWay: false };

const fixtures = fs.readdirSync('./test/data').filter((file) => /\.(osm|json)$/.test(file)
    && !file.startsWith('history')
    && !file.startsWith('monaco'));

/**
 * Compare *shapes*. A ring may start at a different vertex and run the other
 * way round in the two implementations; both are normatively checked elsewhere
 * (RFC 7946 winding, our own snapshots), so they are normalised here to keep
 * the comparison about geometry, not vertex order.
 */
function canonicalRing(ring: number[][]): number[][] {
    const open = ring.slice(0, -1);
    let first = 0;
    for (let i = 1; i < open.length; i++) {
        if (JSON.stringify(open[i]) < JSON.stringify(open[first])) {
            first = i;
        }
    }
    const rotated = [...open.slice(first), ...open.slice(0, first)];
    const forward = [...rotated, rotated[0]];
    const backward = [forward[0], ...forward.slice(1, -1).reverse(), forward[0]];
    return JSON.stringify(forward) <= JSON.stringify(backward) ? forward : backward;
}

function canonicalGeometry(geometry: any): any {
    if (!geometry) {
        return null;
    }
    const sortKey = (value: any) => JSON.stringify(value);
    if (geometry.type === 'MultiLineString') {
        const lines = [...geometry.coordinates].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
        return lines.length === 1
            ? { type: 'LineString', coordinates: lines[0] }
            : { type: 'MultiLineString', coordinates: lines };
    }
    if (geometry.type === 'Polygon') {
        const [outer, ...holes] = geometry.coordinates.map(canonicalRing);
        return { type: 'Polygon', coordinates: [outer, ...holes.sort((a: any, b: any) => (sortKey(a) < sortKey(b) ? -1 : 1))] };
    }
    if (geometry.type === 'MultiPolygon') {
        const polygons = geometry.coordinates.map((rings: number[][][]) => {
            const [outer, ...holes] = rings.map(canonicalRing);
            return [outer, ...holes.sort((a: any, b: any) => (sortKey(a) < sortKey(b) ? -1 : 1))];
        });
        return { type: 'MultiPolygon', coordinates: polygons.sort((a: any, b: any) => (sortKey(a[0]) < sortKey(b[0]) ? -1 : 1)) };
    }
    return geometry;
}

const referenceCache = new Map<string, any>();

/** The reference conversion is expensive on the large extracts: convert once. */
function referenceFeatureCollection(file: string): any {
    const cached = referenceCache.get(file);
    if (cached) {
        return cached;
    }
    const raw = fs.readFileSync(`./test/data/${file}`, 'utf-8').replace(/^\uFEFF/, '');
    const converted = file.endsWith('.json')
        ? osmtogeojson(JSON.parse(raw))
        : osmtogeojson(new DOMParser().parseFromString(raw, 'text/xml'));
    referenceCache.set(file, converted);
    return converted;
}

describe('differential against osmtogeojson', () => {
    it('has fixtures to compare', () => {
        expect(fixtures.length).toBeGreaterThan(15);
    });

    for (const file of fixtures) {
        // osmtogeojson needs seconds on the large extracts under a shared CI runner.
        it(`matches reference feature selection for ${file}`, { timeout: 60_000 }, () => {
            const raw = fs.readFileSync(`./test/data/${file}`, 'utf-8').replace(/^\uFEFF/, '');
            const ours = osm2geojson(file.endsWith('.json') ? JSON.parse(raw) : raw, opts) as any;
            const theirs = referenceFeatureCollection(file) as any;

            const ourIds = new Set(ours.features.map((feature: any) => feature.id));
            const theirIds = new Set(theirs.features.map((feature: any) => feature.id));
            const oursOnly = [...ourIds].filter((id) => !theirIds.has(id)).sort();
            const theirsOnly = [...theirIds].filter((id) => !ourIds.has(id)).sort();

            const typeDifferences: Record<string, string> = {};
            const ourMap = new Map(ours.features.map((feature: any) => [feature.id, feature]));
            for (const feature of theirs.features) {
                const mine = ourMap.get(feature.id) as any;
                if (!mine) {
                    continue;
                }
                const ourType = canonicalGeometry(mine.geometry)?.type ?? 'none';
                const theirType = canonicalGeometry(feature.geometry)?.type ?? 'none';
                if (ourType !== theirType) {
                    typeDifferences[feature.id] = `${ourType}/${theirType}`;
                }
            }

            const known = KNOWN_DIFFERENCES[file] || { oursOnly: [], theirsOnly: [], typeDifferences: {} };
            expect(oursOnly, `${file}: undocumented features only we emit (${(known as any).reason || ''})`).toEqual((known.oursOnly || []).slice().sort());
            expect(theirsOnly, `${file}: undocumented features only the reference emits (${(known as any).reason || ''})`).toEqual((known.theirsOnly || []).slice().sort());
            expect(typeDifferences, `${file}: undocumented geometry type differences`).toEqual(known.typeDifferences || {});
        });

        if (STRICT.has(file)) {
            it(`matches reference geometry exactly for ${file}`, { timeout: 60_000 }, () => {
                const raw = fs.readFileSync(`./test/data/${file}`, 'utf-8').replace(/^\uFEFF/, '');
                const ours = osm2geojson(file.endsWith('.json') ? JSON.parse(raw) : raw, opts) as any;
                const theirs = referenceFeatureCollection(file) as any;
                const theirMap = new Map(theirs.features.map((feature: any) => [feature.id, feature]));

                for (const feature of ours.features) {
                    const reference = theirMap.get(feature.id) as any;
                    if (!reference) {
                        continue;
                    }
                    expect(canonicalGeometry(feature.geometry), `${file}: ${feature.id}`)
                        .toEqual(canonicalGeometry(reference.geometry));
                }
            });
        }
    }
});
