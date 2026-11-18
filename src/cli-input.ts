import * as zlib from 'node:zlib';

import { detectCompression } from './compressed';

/** Input accepted by `osm2geojson`: text for XML/JSON, bytes for PBF. */
type CliInput = string | Uint8Array;

/**
 * PBF is a binary container while XML and JSON start with '<' or '{'.
 * Sniffing the content instead of the extension keeps stdin working.
 */
function looksLikeText(data: Uint8Array): boolean {
    let i = 0;
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        i = 3;
    }
    while (i < data.length && (data[i] === 0x20 || data[i] === 0x09 || data[i] === 0x0a || data[i] === 0x0d)) {
        i++;
    }
    return data[i] === 0x3c || data[i] === 0x7b;
}

/**
 * The content size the first zstd frame declares, if it declares one
 * (RFC 8878 §3.1.1.1). `zstd` and Node write it whenever the input size is
 * known, which covers files.
 */
export function zstdContentSize(data: Uint8Array): number | undefined {
    if (data.length < 5) {
        return undefined;
    }
    const descriptor = data[4];
    const fcsFlag = descriptor >> 6;
    const singleSegment = (descriptor >> 5) & 1;
    const fcsBytes = [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag];
    if (fcsBytes === 0) {
        return undefined;
    }
    const at = 5 + (singleSegment ? 0 : 1) + [0, 1, 2, 4][descriptor & 3];
    if (at + fcsBytes > data.length) {
        return undefined;
    }
    let size = 0;
    for (let i = fcsBytes - 1; i >= 0; i--) {
        size = size * 256 + data[at + i];
    }
    return fcsBytes === 2 ? size + 256 : size;
}

/**
 * Node 22 returns what it decoded so far from a truncated zstd stream instead
 * of throwing (Node 24 throws), so compare with the declared size.
 */
function checkZstdLength(data: Uint8Array, output: Buffer): Buffer {
    const expected = zstdContentSize(data);
    if (expected !== undefined && output.length < expected) {
        throw new Error(`truncated zstd input: ${output.length} of ${expected} bytes`);
    }
    return output;
}

/**
 * Decompress a gzip or zstd container. bzip2 and xz are recognised only to
 * report them clearly: Node has no decoder for either, and a wrong guess would
 * surface as a confusing PBF error.
 */
export function decompress(data: Buffer): Buffer {
    switch (detectCompression(data)) {
        case 'gzip':
            return zlib.gunzipSync(data);
        case 'zstd':
            // Added in Node.js 22.15; the library itself supports any Node 22.
            if (typeof zlib.zstdDecompressSync !== 'function') {
                throw new Error(`zstd input needs Node.js 22.15 or later (running ${process.versions.node}), decompress it first (e.g. unzstd)`);
            }
            return checkZstdLength(data, zlib.zstdDecompressSync(data));
        case 'bzip2':
            throw new Error('bzip2 input is not supported, decompress it first (e.g. bunzip2)');
        case 'xz':
            throw new Error('xz input is not supported, decompress it first (e.g. unxz)');
        default:
            return data;
    }
}

/** Decompress if needed, then hand the converter either text or bytes. */
export function decodeInput(data: Buffer): CliInput {
    const payload = decompress(data);
    return looksLikeText(payload) ? payload.toString('utf-8') : payload;
}
