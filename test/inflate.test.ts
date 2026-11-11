import { describe, it, expect } from 'vitest';
import { deflateSync, constants } from 'node:zlib';
import { inflate } from '../src/inflate';

function roundTrip(input: Uint8Array, level: number, strategy?: number) {
    const compressed = deflateSync(input, { level, strategy });
    return inflate(new Uint8Array(compressed), 0, compressed.length, input.length);
}

function sample(size: number, seed: number): Uint8Array {
    const data = new Uint8Array(size);
    let state = seed;
    for (let i = 0; i < size; i++) {
        // Mix structured and pseudo-random bytes so both Huffman paths are hit.
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        data[i] = i % 3 === 0 ? state & 0xff : (i & 0x1f);
    }
    return data;
}

describe('inflate', () => {
    it('decompresses empty input', () => {
        expect(roundTrip(new Uint8Array(0), 6)).toEqual(new Uint8Array(0));
    });

    it('decompresses a short literal run for every level and strategy', () => {
        const input = new TextEncoder().encode('osm pbf blocks are zlib streams '.repeat(20));
        for (const level of [0, 1, 6, 9]) {
            expect(roundTrip(input, level)).toEqual(input);
        }
        for (const strategy of [constants.Z_FIXED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE, constants.Z_DEFAULT_STRATEGY]) {
            expect(roundTrip(input, 6, strategy)).toEqual(input);
        }
    });

    it('decompresses larger pseudo-random buffers', () => {
        for (const size of [1024, 65536, 300000]) {
            const input = sample(size, size);
            expect(roundTrip(input, 6)).toEqual(input);
        }
    });

    it('decompresses highly compressible data that needs long back-references', () => {
        const input = new Uint8Array(200000);
        expect(roundTrip(input, 9)).toEqual(input);
    });

    it('grows the output buffer beyond its size hint', () => {
        const input = sample(150000, 7);
        const compressed = deflateSync(input);
        expect(inflate(new Uint8Array(compressed), 0, compressed.length, 16)).toEqual(input);
    });

    it('rejects non-zlib input', () => {
        expect(() => inflate(new Uint8Array([0, 1, 2, 3]))).toThrow(/compression method/);
        expect(() => inflate(new Uint8Array([0x78, 0xbb, 0, 0]))).toThrow(/preset dictionar/);
    });
});
