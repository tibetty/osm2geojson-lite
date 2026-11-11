import { describe, it, expect } from 'vitest';
import { deflateSync, constants } from 'node:zlib';
import { inflate } from '../src/inflate';

function roundTrip(input: Uint8Array, options: { level?: number, strategy?: number, memLevel?: number } = {}): Uint8Array {
    const compressed = deflateSync(input, options);
    return inflate(new Uint8Array(compressed), 0, compressed.length, input.length);
}

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

function text(size: number): Uint8Array {
    const words = ['node', 'way', 'relation', 'highway', 'residential', 'building', 'yes', 'name'];
    let out = '';
    let i = 0;
    while (out.length < size) {
        out += `<tag k="${words[i % words.length]}" v="${words[(i * 5) % words.length]}" id="${i}"/>`;
        i++;
    }
    return new TextEncoder().encode(out.slice(0, size));
}

function alternating(size: number): Uint8Array {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        data[i] = i % 2 === 0 ? 0 : 0xff;
    }
    return data;
}

describe('inflate round-trips', () => {
    const patterns: Array<{ name: string, data: Uint8Array }> = [
        { name: 'empty', data: new Uint8Array(0) },
        { name: 'single byte', data: new Uint8Array([42]) },
        { name: 'zeros 64 KiB', data: new Uint8Array(64 * 1024) },
        { name: 'alternating 64 KiB', data: alternating(64 * 1024) },
        { name: 'text 64 KiB', data: text(64 * 1024) },
        { name: 'noise 64 KiB', data: noise(64 * 1024, 3) },
        { name: 'crossing 64 KiB', data: new Uint8Array(Array.from({ length: 64 * 1024 }, (unused, i) => (i * 7) % 251)) },
    ];

    for (const { name, data } of patterns) {
        it(`matches zlib for ${name} at every level`, () => {
            for (let level = 0; level <= 9; level++) {
                const result = roundTrip(data, { level });
                expect(result.length).toBe(data.length);
                expect(result).toEqual(data);
            }
        });

        it(`matches zlib for ${name} under every strategy`, () => {
            for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE, constants.Z_FIXED]) {
                const result = roundTrip(data, { level: 6, strategy });
                expect(result).toEqual(data);
            }
        });
    }

    it('matches zlib with small memLevel and multi-block stored streams', () => {
        const data = text(200 * 1024);
        for (const memLevel of [1, 3, 9]) {
            expect(roundTrip(data, { level: 4, memLevel })).toEqual(data);
        }
        // Level 0 splits into 65 535-byte stored blocks.
        const stored = noise(200 * 1024, 4);
        expect(roundTrip(stored, { level: 0 })).toEqual(stored);
    });

    it('matches zlib for a 1 MiB payload', () => {
        const data = noise(1 << 20, 11);
        expect(roundTrip(data, { level: 6 })).toEqual(data);
    });

    it('honours a size hint that is too small or too large', () => {
        const data = text(150 * 1024);
        const compressed = deflateSync(data, { level: 9 });
        expect(inflate(new Uint8Array(compressed), 0, compressed.length, 1)).toEqual(data);
        expect(inflate(new Uint8Array(compressed), 0, compressed.length, 4 << 20)).toEqual(data);
    });
});

describe('inflate rejects bad input', () => {
    const data = text(32 * 1024);

    it('rejects non-zlib headers', () => {
        expect(() => inflate(new Uint8Array([0, 1, 2, 3]))).toThrow(/compression method/);
        expect(() => inflate(new Uint8Array([0x78, 0xbb, 0, 0]))).toThrow(/preset dictionar/);
        expect(() => inflate(new Uint8Array([0x78, 0x9c, 0, 0]))).toThrow(/truncated/);
    });

    it('rejects truncation at every cut point', () => {
        const compressed = new Uint8Array(deflateSync(data, { level: 6 }));
        for (let cut = 2; cut <= compressed.length - 1; cut += Math.max(1, Math.floor(compressed.length / 40))) {
            expect(() => inflate(compressed, 0, cut, data.length), `cut at ${cut}`).toThrow();
        }
    });

    it('rejects a corrupted checksum', () => {
        const compressed = new Uint8Array(deflateSync(data, { level: 6 }));
        compressed[compressed.length - 1] ^= 0xff;
        expect(() => inflate(compressed, 0, compressed.length, data.length)).toThrow(/checksum/);
    });

    it('rejects corrupt payload bytes instead of returning wrong output', () => {
        const compressed = new Uint8Array(deflateSync(data, { level: 6 }));
        let rejected = 0;
        for (let at = 2; at < compressed.length - 4; at += 97) {
            const copy = new Uint8Array(compressed);
            copy[at] ^= 0x5a;
            try {
                const out = inflate(copy, 0, copy.length, data.length);
                // Any corruption that still decodes must at least match the input.
                expect(out).toEqual(data);
            } catch {
                rejected++;
            }
        }
        expect(rejected).toBeGreaterThan(0);
    });

    it('rejects a corrupt stored-block length', () => {
        const compressed = new Uint8Array(deflateSync(noise(4096, 9), { level: 0 }));
        // Skip the 2-byte zlib header and the 5-byte stored block header.
        compressed[7] ^= 0xff;
        expect(() => inflate(compressed, 0, compressed.length, 4096)).toThrow();
    });
});
