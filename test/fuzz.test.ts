import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson, { toElements } from '../src/index';
import { sampleFile } from './pbf-encoder';

/**
 * Seeded mutation fuzzing over the parsers.
 *
 * Fixtures are deliberately valid, so the interesting inputs are the invalid
 * ones. Nothing here asserts specific output: the contract is that a mutation
 * either throws an `Error` (malformed input is allowed to be rejected) or
 * produces a well-formed collection. Compressed containers are not fuzzed here:
 * the library rejects them by design and `test/cli-input.test.ts` covers the
 * decompression path. `TypeError`, `RangeError` and
 * `ReferenceError` are code bugs, not input problems, so they fail the test.
 */

function createRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

type Random = () => number;

const int = (rnd: Random, max: number) => Math.floor(rnd() * (max + 1));

const fixtures: Array<{ name: string, kind: 'text' | 'binary', data: Uint8Array }> = [
    { name: 'map.osm', kind: 'text', data: new Uint8Array(fs.readFileSync('./test/data/map.osm')) },
    { name: 'relation.osm', kind: 'text', data: new Uint8Array(fs.readFileSync('./test/data/relation.osm')) },
    { name: 'monaco-900.osc', kind: 'text', data: new Uint8Array(fs.readFileSync('./test/data/monaco-900.osc')) },
    { name: 'way.json', kind: 'text', data: new Uint8Array(fs.readFileSync('./test/data/way.json')) },
    { name: 'sample.pbf', kind: 'binary', data: sampleFile() },
    { name: 'sample-raw.pbf', kind: 'binary', data: sampleFile('raw') },
];

/** Text inputs must reach the XML/JSON paths, binaries the PBF path. */
function asInput(fixture: { kind: 'text' | 'binary' }, data: Uint8Array): any {
    return fixture.kind === 'text' ? Buffer.from(data).toString('utf-8') : data;
}

function mutate(rnd: Random, source: Uint8Array): Uint8Array {
    let data = new Uint8Array(source);
    const operations = 1 + int(rnd, 2);

    for (let i = 0; i < operations; i++) {
        switch (int(rnd, 4)) {
            case 0: {
                // Flip one byte.
                if (data.length === 0) break;
                const at = int(rnd, data.length - 1);
                data[at] ^= 1 << int(rnd, 7);
                break;
            }
            case 1: {
                // Truncate, keeping at least a byte.
                data = data.subarray(0, Math.max(1, int(rnd, data.length - 1)));
                break;
            }
            case 2: {
                // Replace a span with repeated junk.
                const at = int(rnd, Math.max(0, data.length - 1));
                const length = Math.min(data.length - at, 1 + int(rnd, 16));
                data.fill(int(rnd, 255), at, at + length);
                break;
            }
            default: {
                // Insert a short run of junk bytes.
                const at = int(rnd, data.length);
                const junk = new Uint8Array(1 + int(rnd, 8));
                for (let k = 0; k < junk.length; k++) junk[k] = int(rnd, 255);
                const next = new Uint8Array(data.length + junk.length);
                next.set(data.subarray(0, at));
                next.set(junk, at);
                next.set(data.subarray(at), at + junk.length);
                data = next;
                break;
            }
        }
    }

    return data;
}

const opts = { completeFeature: true, renderTagged: true, excludeWay: false, tainted: true };

function isProgramBug(error: unknown): boolean {
    return error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError;
}

describe('mutation fuzzing', () => {
    for (const fixture of fixtures) {
        it(`survives mutations of ${fixture.name}`, () => {
            let rejected = 0;
            let accepted = 0;
            for (let seed = 1; seed <= 60; seed++) {
                const mutated = mutate(createRandom(seed * 7919 + fixture.name.length), fixture.data);
                let result: any;
                try {
                    result = osm2geojson(asInput(fixture, mutated), opts);
                } catch (error) {
                    expect(isProgramBug(error), `${fixture.name} seed ${seed}: ${(error as Error).stack}`).toBe(false);
                    expect(error).toBeInstanceOf(Error);
                    rejected++;
                    continue;
                }

                if (result === undefined) {
                    continue;
                }
                accepted++;
                if (result.type !== 'FeatureCollection') {
                    expect(typeof result.type).toBe('string');
                    continue;
                }
                const ids = result.features.map((feature: any) => feature.id);
                expect(new Set(ids).size, `${fixture.name} seed ${seed}: duplicate ids`).toBe(ids.length);
                for (const feature of result.features) {
                    expect(feature.type).toBe('Feature');
                }

                // The element path must survive the same mutated bytes.
                try {
                    const elements = toElements(asInput(fixture, mutated));
                    expect(Array.isArray(elements)).toBe(true);
                } catch (error) {
                    expect(isProgramBug(error), `${fixture.name} seed ${seed} (toElements): ${(error as Error).stack}`).toBe(false);
                }
            }
            // Guard against a fixture where every mutation is rejected before it
            // reaches the parser, which would make this test vacuous.
            expect(accepted, `${fixture.name}: every mutation was rejected`).toBeGreaterThan(0);
        });
    }
});
