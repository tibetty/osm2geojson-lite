/**
 * Container detection for compressed OSM files.
 *
 * The converter itself takes plain XML/JSON/PBF, but people routinely hold
 * `.osm.gz` / `.osm.zst` files, so the CLI decompresses them and the library
 * turns compressed input into an actionable error instead of a PBF parse
 * failure. Only magic bytes are inspected here; no decompressor is imported,
 * so this module stays usable in the browser build.
 */

export type Compression = 'gzip' | 'zstd' | 'bzip2' | 'xz';

function startsWith(data: Uint8Array, magic: number[]): boolean {
    if (data.length < magic.length) {
        return false;
    }
    for (let i = 0; i < magic.length; i++) {
        if (data[i] !== magic[i]) {
            return false;
        }
    }
    return true;
}

/** Name of the compression container `data` starts with, if any. */
export function detectCompression(data: Uint8Array): Compression | undefined {
    if (startsWith(data, [0x1f, 0x8b])) {
        return 'gzip';
    }
    if (startsWith(data, [0x28, 0xb5, 0x2f, 0xfd])) {
        return 'zstd';
    }
    if (startsWith(data, [0x42, 0x5a, 0x68])) {
        return 'bzip2';
    }
    if (startsWith(data, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
        return 'xz';
    }
    return undefined;
}
