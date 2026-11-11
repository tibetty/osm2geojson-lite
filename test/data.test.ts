import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson, { toElements } from '../src/index';

/**
 * Corpus-wide invariants. Every fixture is converted with three option sets and
 * checked for the properties a GeoJSON consumer relies on: unique feature ids,
 * well-formed features and finite coordinates. The same document is also
 * converted through `toElements` to assert the element path agrees with the
 * direct conversion paths.
 */

const dataDir = './test/data';
const fixtures = fs.readdirSync(dataDir).filter((file) => /\.(osm|json|osc)$/.test(file));

const optionSets: Array<{ name: string, opts: any }> = [
    { name: 'completeFeature', opts: { completeFeature: true } },
    { name: 'completeFeature+renderTagged+tainted', opts: { completeFeature: true, renderTagged: true, excludeWay: false, tainted: true } },
    { name: 'default', opts: {} },
];

const GEOMETRY_TYPES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

function readFixture(file: string): any {
    const path = `${dataDir}/${file}`;
    if (file.endsWith('.json')) {
        return JSON.parse(fs.readFileSync(path, 'utf-8'));
    }
    if (file.endsWith('.pbf')) {
        return new Uint8Array(fs.readFileSync(path));
    }
    return fs.readFileSync(path, 'utf-8');
}

function assertFiniteCoordinates(value: any, path: string): void {
    if (Array.isArray(value)) {
        for (const entry of value) {
            assertFiniteCoordinates(entry, path);
        }
        return;
    }
    expect(typeof value, `${path} coordinate`).toBe('number');
    expect(Number.isFinite(value), `${path} coordinate ${value}`).toBe(true);
}

function assertFeature(feature: any, file: string): void {
    expect(feature.type, `${file}: feature type`).toBe('Feature');
    expect(typeof feature.id, `${file}: feature id`).toBe('string');
    if (feature.geometry === null) {
        return;
    }
    expect(GEOMETRY_TYPES, `${file}: geometry type`).toContain(feature.geometry.type);
    if (feature.geometry.type === 'GeometryCollection') {
        for (const geometry of feature.geometry.geometries) {
            expect(GEOMETRY_TYPES).toContain(geometry.type);
            if (geometry.coordinates) {
                assertFiniteCoordinates(geometry.coordinates, file);
            }
        }
    } else if (feature.geometry.coordinates) {
        assertFiniteCoordinates(feature.geometry.coordinates, file);
    }
}

describe('fixture corpus', () => {
    it('is not empty', () => {
        expect(fixtures.length).toBeGreaterThan(20);
    });

    for (const { name, opts } of optionSets) {
        describe(name, () => {
            for (const file of fixtures) {
                it(`keeps ${file} well-formed and duplicate-free`, () => {
                    const result: any = osm2geojson(readFixture(file), opts);
                    if (result === undefined) {
                        return;
                    }
                    if (result.type !== 'FeatureCollection') {
                        expect(GEOMETRY_TYPES).toContain(result.type);
                        if (result.coordinates) {
                            assertFiniteCoordinates(result.coordinates, file);
                        }
                        return;
                    }

                    const ids = result.features.map((feature: any) => feature.id);
                    expect(new Set(ids).size, `${file}: duplicate feature ids`).toBe(ids.length);
                    for (const feature of result.features) {
                        assertFeature(feature, file);
                    }
                });
            }
        });
    }

    for (const file of fixtures) {
        it(`converts ${file} identically through elements`, () => {
            const opts = { completeFeature: true, renderTagged: true, excludeWay: false, tainted: true };
            const direct = osm2geojson(readFixture(file), opts);
            const viaElements = osm2geojson({ elements: toElements(readFixture(file)) }, opts);
            expect(viaElements).toEqual(direct);
        });
    }
});
