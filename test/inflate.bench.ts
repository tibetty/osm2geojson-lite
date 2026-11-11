import { test } from 'vitest';
import { deflateSync, inflateSync } from 'node:zlib';
import { inflate } from '../src/inflate';

/** Deterministic xorshift32; `Math.imul` keeps it exact in doubles. */
function noise(size: number, seed: number): Uint8Array {
    const data = new Uint8Array(size);
    let state = seed | 0;
    for (let i = 0; i < size; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        data[i] = state & 0xff;
    }
    return data;
}

/** OSM XML with varying ids and coordinates, so it compresses like real data. */
function prose(size: number): Uint8Array {
    const types = ['highway', 'building', 'name', 'place', 'natural', 'surface', 'lanes'];
    const values = ['residential', 'yes', 'Main Street', 'village', 'water', 'asphalt', '2'];
    let text = '';
    let i = 0;
    while (text.length < size) {
        const id = 100000 + i;
        text += `<node id="${id}" version="${1 + (i % 9)}" lat="${(43.7 + i * 0.00001).toFixed(6)}" lon="${(7.4 + i * 0.00002).toFixed(6)}">`;
        text += `<tag k="${types[i % types.length]}" v="${values[(i * 3) % values.length]}"/>`;
        text += '</node>';
        i++;
    }
    return new TextEncoder().encode(text.slice(0, size));
}

/** Varint-shaped binary data, so literal/length mixes resemble a PBF block. */
function varints(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size);
    let at = 0;
    let state = seed | 0;
    while (at < size) {
        state = (Math.imul(state, 1103515245) + 12345) | 0;
        let value = (state >>> 8) & 0x3ffff;
        while (value >= 0x80 && at < size) {
            out[at++] = (value & 0x7f) | 0x80;
            value = Math.floor(value / 128);
        }
        if (at < size) {
            out[at++] = value;
        }
    }
    return out;
}

const payloads: Array<{ name: string, data: Uint8Array }> = [
    { name: 'XML-like 1 MiB', data: prose(1 << 20) },
    { name: 'varint-like 1 MiB', data: varints(1 << 20, 17) },
    { name: 'incompressible 1 MiB', data: noise(1 << 20, 5) },
];

for (const { name, data } of payloads) {
    const compressed = new Uint8Array(deflateSync(data, { level: 6 }));
    test(`inflate · ${name} (${compressed.length} B compressed)`, async ({ bench }) => {
        await bench.compare(
            bench('osm2geojson-lite', () => {
                inflate(compressed, 0, compressed.length, data.length);
            }),
            bench('node:zlib', () => {
                inflateSync(compressed);
            }),
        );
    });
}

// PBF inflates one zlib stream per ~16 KiB block, so per-call overhead matters
// as much as per-byte throughput.
const blocks = Array.from({ length: 64 }, (unused, index) => {
    const data = varints(16 * 1024, index + 1);
    return { data, compressed: new Uint8Array(deflateSync(data, { level: 6 })) };
});

test(`inflate · 64 PBF-sized blocks (${blocks.reduce((sum, block) => sum + block.compressed.length, 0)} B compressed)`, async ({ bench }) => {
    await bench.compare(
        bench('osm2geojson-lite', () => {
            for (const block of blocks) {
                inflate(block.compressed, 0, block.compressed.length, block.data.length);
            }
        }),
        bench('node:zlib', () => {
            for (const block of blocks) {
                inflateSync(block.compressed);
            }
        }),
    );
});
