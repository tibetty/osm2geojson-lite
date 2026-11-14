import { gunzipSync, zstdDecompressSync } from 'node:zlib';

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
 * Decompress a gzip or zstd container. bzip2 and xz are recognised only to
 * report them clearly: Node has no decoder for either, and a wrong guess would
 * surface as a confusing PBF error.
 */
export function decompress(data: Buffer): Buffer {
    switch (detectCompression(data)) {
        case 'gzip':
            return gunzipSync(data);
        case 'zstd':
            return zstdDecompressSync(data);
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
