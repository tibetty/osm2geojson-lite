import { describe, it, expect } from 'vitest';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import osm2geojson from '../src/index';
import { decodeInput, decompress, looksLikeText } from '../src/cli-input';
import { detectCompression } from '../src/compressed';

const XML = '<osm><node id="1" lat="0" lon="0"><tag k="name" v="a"/></node></osm>';

describe('compression detection', () => {
    it('recognises the containers OSM files come in', () => {
        expect(detectCompression(Buffer.from(gzipSync(XML)))).toBe('gzip');
        expect(detectCompression(Buffer.from(zstdCompressSync(XML)))).toBe('zstd');
        expect(detectCompression(Buffer.from('BZh91AY&SY'))).toBe('bzip2');
        expect(detectCompression(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).toBe('xz');
    });

    it('returns undefined for plain text, PBF and short buffers', () => {
        expect(detectCompression(Buffer.from(XML))).toBeUndefined();
        expect(detectCompression(Buffer.from([0, 0, 0, 13]))).toBeUndefined();
        expect(detectCompression(Buffer.from([0x1f]))).toBeUndefined();
    });
});

describe('CLI input', () => {
    it('passes plain XML, JSON and PBF through', () => {
        expect(decodeInput(Buffer.from(XML))).toBe(XML);
        expect(decodeInput(Buffer.from(`  ${XML}`))).toBe(`  ${XML}`);
        expect(decodeInput(Buffer.from('{"elements":[]}'))).toBe('{"elements":[]}');

        const pbf = Buffer.from([0, 0, 0, 13, 10, 9, 79, 83, 77, 72, 101, 97, 100, 101, 114]);
        expect(decodeInput(pbf)).toBe(pbf);
    });

    it('detects text after a UTF-8 BOM and leading whitespace', () => {
        expect(looksLikeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(XML)]))).toBe(true);
        expect(looksLikeText(Buffer.from('\n\t ' + XML))).toBe(true);
    });

    it('decompresses gzip and zstd to text', () => {
        expect(decodeInput(Buffer.from(gzipSync(XML)))).toBe(XML);
        expect(decodeInput(Buffer.from(zstdCompressSync(XML)))).toBe(XML);
    });

    it('decompresses gzip around a binary PBF payload', () => {
        const pbf = Buffer.from([0, 0, 0, 13, 10, 9, 79, 83, 77, 72, 101, 97, 100, 101, 114]);
        const decoded = decodeInput(Buffer.from(gzipSync(pbf))) as Uint8Array;
        expect(Buffer.from(decoded).equals(pbf)).toBe(true);
    });

    it('reports bzip2 and xz instead of guessing', () => {
        expect(() => decompress(Buffer.from('BZh91AY&SY'))).toThrow(/bzip2 input is not supported/);
        expect(() => decompress(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).toThrow(/xz input is not supported/);
    });

    it('converts a gzipped extract end to end', () => {
        const result = osm2geojson(decodeInput(Buffer.from(gzipSync(XML))), { completeFeature: true }) as any;
        expect(result.features[0].properties).toEqual({ id: 'node/1', name: 'a' });
    });
});

describe('library input', () => {
    it('explains that compressed bytes must be decompressed first', () => {
        const gzipped = new Uint8Array(gzipSync(XML));
        expect(() => osm2geojson(gzipped)).toThrow(/gzip input is not supported by the library/);
        expect(() => osm2geojson(new Uint8Array(zstdCompressSync(XML)))).toThrow(/zstd input is not supported by the library/);
    });
});
