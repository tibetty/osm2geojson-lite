import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange, toElements } from '../src/index';

/**
 * Seeded property sweep. The fixture corpus covers realistic documents; this
 * covers the combinations nobody writes a fixture for: duplicate versions,
 * deletions mixed with visible copies, dangling references, negative ids,
 * missing coordinates and contradictory tag sets.
 *
 * Every generated document must convert without throwing, produce unique and
 * well-formed features, convert identically through the element path, and merge
 * with a generated diff without duplicating elements.
 */

function createRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

type Random = () => number;

const pick = <T>(rnd: Random, values: T[]): T => values[Math.floor(rnd() * values.length)];
const chance = (rnd: Random, probability: number) => rnd() < probability;
const int = (rnd: Random, max: number) => Math.floor(rnd() * (max + 1));

const ROADS = ['residential', 'footway', 'primary', 'steps'];
const RELATION_TYPES = ['multipolygon', 'boundary', 'route', 'site', 'associatedStreet', undefined];

function randomTags(rnd: Random): any {
    const tags: any = {};
    if (chance(rnd, 0.7)) tags.highway = pick(rnd, ROADS);
    if (chance(rnd, 0.3)) tags.name = pick(rnd, ['Main', 'モナコ', 'A & B', "Cap d'Ail"]);
    if (chance(rnd, 0.2)) tags.building = 'yes';
    if (chance(rnd, 0.15)) tags.natural = 'water';
    return tags;
}

function randomDocument(rnd: Random, idBase: number): any[] {
    const elements: any[] = [];
    const nodeCount = int(rnd, 7);
    const nodeIds: number[] = [];

    for (let i = 0; i < nodeCount; i++) {
        const id = idBase + i + 1;
        nodeIds.push(id);
        const copy: any = { type: 'node', id };
        if (chance(rnd, 0.85)) {
            copy.lat = Math.round(rnd() * 200 - 100) / 1000;
            copy.lon = Math.round(rnd() * 200 - 100) / 1000;
        }
        if (chance(rnd, 0.7)) copy.version = int(rnd, 4);
        const tags = randomTags(rnd);
        if (Object.keys(tags).length > 0) copy.tags = tags;
        if (chance(rnd, 0.08)) copy.visible = false;
        if (chance(rnd, 0.1)) copy.id = -copy.id;
        elements.push(copy);

        // Duplicate copy: either another version with a deletion, a skeleton or
        // the same version with complementary data.
        if (chance(rnd, 0.35)) {
            const twin: any = { type: 'node', id: copy.id };
            if (chance(rnd, 0.4)) {
                twin.version = typeof copy.version === 'number' ? copy.version + int(rnd, 2) : int(rnd, 4);
                if (chance(rnd, 0.4)) twin.visible = false;
                if (!twin.visible) {
                    twin.lat = copy.lat;
                    twin.lon = copy.lon;
                }
            } else {
                twin.version = copy.version;
                twin.tags = { name: 'twin' };
            }
            if (!('lat' in twin)) {
                twin.lat = Math.round(rnd() * 100) / 100;
                twin.lon = Math.round(rnd() * 100) / 100;
            }
            elements.push(twin);
        }
    }

    const wayCount = int(rnd, 3);
    for (let i = 0; i < wayCount; i++) {
        const way: any = { type: 'way', id: idBase + 100 + i };
        const refs = nodeIds.filter(() => chance(rnd, 0.7));
        if (chance(rnd, 0.2)) refs.push(idBase + 999); // dangling reference
        if (refs.length > 0) way.nodes = refs;
        if (chance(rnd, 0.7)) way.version = int(rnd, 3);
        const tags = randomTags(rnd);
        if (Object.keys(tags).length > 0) way.tags = tags;
        if (chance(rnd, 0.1)) way.visible = false;
        if (chance(rnd, 0.15) && refs.length > 1) {
            // Derive geometry instead of references, like `out geom`.
            way.geometry = refs.map(() => ({ lat: Math.round(rnd() * 100) / 100, lon: Math.round(rnd() * 100) / 100 }));
            delete way.nodes;
        }
        elements.push(way);

        if (chance(rnd, 0.2)) {
            const twin: any = { type: 'way', id: way.id, version: (way.version || 0) + 1, tags: way.tags };
            if (!way.geometry) {
                twin.nodes = way.nodes;
            }
            elements.push(twin);
        }
    }

    const relationCount = int(rnd, 2);
    for (let i = 0; i < relationCount; i++) {
        const type = pick(rnd, RELATION_TYPES);
        const relation: any = { type: 'relation', id: idBase + 200 + i, tags: {} };
        if (type) relation.tags.type = type;
        if (chance(rnd, 0.5)) relation.tags.name = 'r';
        const members: any[] = [];
        for (const node of nodeIds) {
            if (chance(rnd, 0.25)) members.push({ type: 'node', ref: node, role: pick(rnd, ['', 'label', 'stop']) });
        }
        for (let w = 0; w < wayCount; w++) {
            if (chance(rnd, 0.5)) members.push({ type: 'way', ref: idBase + 100 + w, role: pick(rnd, ['', 'outer', 'inner', 'platform']) });
        }
        if (chance(rnd, 0.15)) members.push({ type: 'relation', ref: idBase + 200 + ((i + 1) % 2), role: 'sub' });
        if (chance(rnd, 0.1)) members.push({ type: 'way', ref: idBase + 777, role: 'outer' }); // dangling
        relation.members = members;
        relation.version = int(rnd, 2);
        elements.push(relation);
    }

    return elements;
}

function randomDiff(rnd: Random, base: any[]): any[] {
    const diff: any[] = [];
    const touched = base.filter(() => chance(rnd, 0.25));
    for (const element of touched) {
        const version = typeof element.version === 'number' ? element.version : 0;
        const roll = rnd();
        if (roll < 0.4) {
            // Delete at the base version (the normal case) or one below it.
            const deletion: any = { type: element.type, id: element.id, version: Math.max(0, version - int(rnd, 1)) };
            if (chance(rnd, 0.15)) deletion.version = version + int(rnd, 2); // stale delete
            diff.push(deletion);
        } else if (roll < 0.8) {
            const modify: any = { type: element.type, id: element.id, version: version + 1 };
            if (element.type === 'node') {
                modify.lat = Math.round(rnd() * 100) / 100;
                modify.lon = Math.round(rnd() * 100) / 100;
            }
            if (element.type === 'way') modify.nodes = [1, 2];
            if (element.type === 'relation') modify.members = [];
            modify.tags = { source: 'diff' };
            diff.push(modify);
        } else {
            diff.push({ type: element.type, id: element.id, version: Math.max(0, version - 2) });
        }
    }
    // A create that is not in the base.
    if (chance(rnd, 0.5)) {
        diff.push({ type: 'node', id: 900001, version: 1, lat: 1, lon: 2, tags: { name: 'new' } });
    }
    return diff;
}

const opts = { completeFeature: true, renderTagged: true, excludeWay: false, tainted: true };

function assertFinite(value: any): void {
    if (Array.isArray(value)) {
        for (const entry of value) assertFinite(entry);
        return;
    }
    expect(Number.isFinite(value)).toBe(true);
}

describe('generated documents', () => {
    for (let seed = 1; seed <= 120; seed++) {
        it(`holds its invariants (seed ${seed})`, () => {
            const rnd = createRandom(seed);
            const elements = randomDocument(rnd, 1000);

            const result: any = osm2geojson({ elements }, opts);
            const ids = result.features.map((feature: any) => feature.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const feature of result.features) {
                if (feature.geometry && feature.geometry.coordinates) {
                    assertFinite(feature.geometry.coordinates);
                }
            }

            const viaElements: any = osm2geojson({ elements: toElements({ elements }) }, opts);
            expect(viaElements).toEqual(result);

            const diff = randomDiff(rnd, elements);
            const merged = mergeOsmChange({ elements }, { elements: diff });
            const mergedIds = merged.elements.map((element) => `${element.type}/${element.id}`);
            expect(new Set(mergedIds).size).toBe(mergedIds.length);
            for (const conflict of merged.conflicts) {
                expect(conflict.id).toMatch(/^(node|way|relation)\/-?\d+$/);
                expect(Number.isFinite(conflict.changeVersion)).toBe(true);
                expect(Number.isFinite(conflict.baseVersion)).toBe(true);
            }

            const applied = applyOsmChange({ elements }, { elements: diff }, opts);
            const appliedIds = (applied.geojson as any).features.map((feature: any) => feature.id);
            expect(new Set(appliedIds).size).toBe(appliedIds.length);
        });
    }
});
