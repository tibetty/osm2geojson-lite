import { addToMap, coordsToKey, first, getFirstFromMap, isRing, last, removeFromMap, ringDirection } from "./utils";
import type { Way } from "./way";

const enum MergeType {
    EndStart,
    EndEnd,
    StartStart,
    StartEnd
}

/**
 * A collection of way coordinate arrays that can be stitched back into lines
 * or rings.
 *
 * The previous implementation extended `Array` and relied on `shift()` plus
 * `splice(indexOf(...))` while merging, which is O(n^2) for relations made of
 * many ways. This version keeps a cursor over a fixed array and marks consumed
 * entries, so merging is linear apart from the small per-coordinate-end maps.
 */
export class WayCollection {
    private ways: number[][][];
    private firstMap: Record<string, number[][][]>;
    private lastMap: Record<string, number[][][]>;
    private used: boolean[];
    private indexByWay: Map<number[][], number>;
    private head: number;

    constructor() {
        this.ways = [];
        this.firstMap = {};
        this.lastMap = {};
        this.used = [];
        this.indexByWay = new Map();
        this.head = 0;
    }

    public addWay(way: Way) {
        const w = way.toCoordsArray();
        if (w.length > 0) {
            const index = this.ways.length;
            this.ways.push(w);
            this.used.push(false);
            this.indexByWay.set(w, index);
            addToMap(this.firstMap, coordsToKey(first(w)), w);
            addToMap(this.lastMap, coordsToKey(last(w)), w);
        }
    }

    public mergeWays(): number[][][] {
        const strings: number[][][] = [];
        let index = this.firstUnused();
        while (index >= 0) {
            const way = this.ways[index];
            this.consume(index, way);
            let current = way;
            for (;;) {
                const found = this.getNextWay(current);
                const next = found.next;
                if (!next) {
                    break;
                }
                const nextIndex = this.indexByWay.get(next);
                if (nextIndex === undefined) {
                    break;
                }
                this.consume(nextIndex, next);
                switch (found.mergeType) {
                    case MergeType.EndStart:
                        current = current.concat(next.slice(1));
                        break;
                    case MergeType.EndEnd:
                        next.reverse();
                        current = current.concat(next.slice(1));
                        break;
                    case MergeType.StartStart:
                        current.reverse();
                        current = current.concat(next.slice(1));
                        break;
                    case MergeType.StartEnd:
                        current = next.concat(current.slice(1));
                        current.reverse();
                        break;
                }
            }
            strings.push(current);
            index = this.firstUnused();
        }

        return strings;
    }

    private firstUnused(): number {
        while (this.head < this.ways.length && this.used[this.head]) {
            this.head++;
        }
        return this.head < this.ways.length ? this.head : -1;
    }

    private consume(index: number, way: number[][]) {
        this.used[index] = true;
        removeFromMap(this.firstMap, coordsToKey(first(way)), way);
        removeFromMap(this.lastMap, coordsToKey(last(way)), way);
    }

    /**
     * Try to find the next way to add to the current way.
     * It first tries the next unused way in the array, and if this doesn't work,
     * tries any other way through the endpoint maps.
     */
    private getNextWay(current: number[][]): { next: number[][] | null; mergeType: MergeType } {
        const lastKey = coordsToKey(last(current));
        const firstKey = coordsToKey(first(current));

        // Step 1: Prefer the next unused way in the array if it connects
        const candidateIndex = this.firstUnused();
        const next = candidateIndex >= 0 ? this.ways[candidateIndex] : null;
        if (next) {
            const nextFirstKey = coordsToKey(first(next));
            const nextLastKey = coordsToKey(last(next));
            if (lastKey === nextFirstKey) {
                return { next, mergeType: MergeType.EndStart };
            }
            if (lastKey === nextLastKey) {
                return { next, mergeType: MergeType.EndEnd };
            }
            if (firstKey === nextFirstKey) {
                return { next, mergeType: MergeType.StartStart };
            }
            if (firstKey === nextLastKey) {
                return { next, mergeType: MergeType.StartEnd };
            }
        }

        // Step 2: Fallback to map-based lookup if no sequential match
        const fromFirst = getFirstFromMap(this.firstMap, lastKey);
        if (fromFirst) {
            return { next: fromFirst, mergeType: MergeType.EndStart };
        }
        const fromLast = getFirstFromMap(this.lastMap, lastKey);
        return { next: fromLast, mergeType: MergeType.EndEnd };
    }

    public toRings(direction: string): number[][][] {
        const strings = this.mergeWays();
        const rings: number[][][] = [];
        for (let i = 0; i < strings.length; i++) {
            const str = strings[i];
            if (isRing(str)) {
                if (ringDirection(str) !== direction) {
                    str.reverse();
                }
                rings.push(str);
            }
        }
        return rings;
    }
}
