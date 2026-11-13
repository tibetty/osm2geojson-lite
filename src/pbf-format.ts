import { parseOsmPbf } from './pbf';
import { detectCompression } from './compressed';
import { analyzeElements } from './element-analyze';
import type { Reader } from './reader';

function toBytes(input: any): Uint8Array {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBuffer);
    const compression = detectCompression(bytes);
    if (compression) {
        throw new Error(`${compression} input is not supported by the library, decompress it first (the CLI does this automatically)`);
    }
    return bytes;
}

/** OSM PBF, decoded into the same elements the JSON reader consumes. */
export const pbfReader: Reader = {
    analyze(input, refElements) {
        analyzeElements(parseOsmPbf(toBytes(input)), refElements);
    },
    read(input) {
        return parseOsmPbf(toBytes(input)).elements;
    },
};
