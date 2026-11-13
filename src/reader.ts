import type { RefElements } from './ref-elements';

/** One document in any format the library reads. */
export type OsmInput = string | { [k: string]: any } | Uint8Array | ArrayBuffer;

/** Format families, each with its own reader. */
export type Format = 'xml' | 'json' | 'pbf';

/**
 * A format reader. `analyze` feeds one document into an element registry;
 * `read` returns one document as raw elements.
 */
export interface Reader {
    analyze(input: any, refElements: RefElements): void;
    read(input: any): any[];
}

/** The readers an entry point understands. */
export type Readers = Partial<Record<Format, Reader>>;

/** Binary input is OSM PBF; text input is OSM XML or OSM/Overpass JSON. */
export function isBinary(o: OsmInput): boolean {
    return o instanceof Uint8Array || o instanceof ArrayBuffer;
}

export function detectFormat(o: OsmInput): 'json' | 'xml' | 'json-raw' | 'pbf' | 'invalid' {
    if (isBinary(o)) {
        return 'pbf';
    }
    if (o && typeof o === 'object' && (o as { [k: string]: any }).elements) {
        return 'json';
    }
    if (typeof o === 'string') {
        if (o.indexOf('<osm') >= 0) {
            return 'xml';
        }
        if (o.trim().startsWith('{')) {
            return 'json-raw';
        }
    }
    return 'invalid';
}
