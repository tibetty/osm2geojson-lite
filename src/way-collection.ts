import { addToMap, coordsToKey, first, getFirstFromMap, isRing, last, removeFromMap, ringDirection } from "./utils";
import type { Way } from "./way";

const enum MergeType {
    EndStart,
    EndEnd,
    StartStart,
    StartEnd
}

/**
 * A growable point sequence with O(1) reverse and amortised O(1) append.
 *
 * `left` is stored in reverse order, so the logical sequence is
 * `reverse(left) + right`. Reversing therefore only swaps the two arrays and
 * appending always targets `right`. This lets the line/ring stitcher grow a
 * path without repeatedly copying the accumulated coordinates.
 */
class PointDeque {
    private left: number[][];
    private right: number[][];
    public headKey: string;
    public tailKey: string;

    constructor(first: number[][], firstKey: string, lastKey: string) {
        this.left = [];
        this.right = first.slice();
        this.headKey = firstKey;
        this.tailKey = lastKey;
    }

    public reverse() {
        const tmp = this.left;
        this.left = this.right;
        this.right = tmp;
        const key = this.headKey;
        this.headKey = this.tailKey;
        this.tailKey = key;
    }

    /** Append a segment, dropping its first point (the shared joint). */
    public append(segment: number[][], segmentLastKey: string) {
        for (let i = 1; i < segment.length; i++) {
            this.right.push(segment[i]);
        }
        this.tailKey = segmentLastKey;
    }

    public flatten(): number[][] {
        const result = new Array<number[]>(this.left.length + this.right.length);
        let at = 0;
        for (let i = this.left.length - 1; i >= 0; i--) {
            result[at++] = this.left[i];
        }
        for (let i = 0; i < this.right.length; i++) {
            result[at++] = this.right[i];
        }
        return result;
    }
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
    private firstKeys: string[];
    private lastKeys: string[];
    private firstMap: Record<string, number[][][]>;
    private lastMap: Record<string, number[][][]>;
    private used: boolean[];
    private indexByWay: Map<number[][], number>;
    private head: number;

    constructor() {
        this.ways = [];
        this.firstKeys = [];
        this.lastKeys = [];
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
            const firstKey = coordsToKey(first(w));
            const lastKey = coordsToKey(last(w));
            this.ways.push(w);
            this.firstKeys.push(firstKey);
            this.lastKeys.push(lastKey);
            this.used.push(false);
            this.indexByWay.set(w, index);
            addToMap(this.firstMap, firstKey, w);
            addToMap(this.lastMap, lastKey, w);
        }
    }

    public mergeWays(): number[][][] {
        const strings: number[][][] = [];
        let index = this.firstUnused();
        while (index >= 0) {
            const way = this.ways[index];
            this.consume(index);
            const deque = new PointDeque(way, this.firstKeys[index], this.lastKeys[index]);
            for (;;) {
                const found = this.getNextWay(deque.headKey, deque.tailKey);
                const next = found.next;
                if (!next) {
                    break;
                }
                const nextIndex = this.indexByWay.get(next);
                if (nextIndex === undefined) {
                    break;
                }
                this.consume(nextIndex);
                switch (found.mergeType) {
                    case MergeType.EndStart:
                        deque.append(next, this.lastKeys[nextIndex]);
                        break;
                    case MergeType.EndEnd:
                        next.reverse();
                        deque.append(next, this.firstKeys[nextIndex]);
                        break;
                    case MergeType.StartStart:
                        deque.reverse();
                        deque.append(next, this.lastKeys[nextIndex]);
                        break;
                    case MergeType.StartEnd:
                        next.reverse();
                        deque.reverse();
                        deque.append(next, this.firstKeys[nextIndex]);
                        break;
                }
            }
            strings.push(deque.flatten());
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

    private consume(index: number) {
        this.used[index] = true;
        const way = this.ways[index];
        removeFromMap(this.firstMap, this.firstKeys[index], way);
        removeFromMap(this.lastMap, this.lastKeys[index], way);
    }

    /**
     * Try to find the next way to add to the current way.
     * It first tries the next unused way in the array, and if this doesn't work,
     * tries any other way through the endpoint maps.
     */
    private getNextWay(headKey: string, tailKey: string): { next: number[][] | null; mergeType: MergeType } {
        // Step 1: Prefer the next unused way in the array if it connects
        const candidateIndex = this.firstUnused();
        const next = candidateIndex >= 0 ? this.ways[candidateIndex] : null;
        if (next) {
            const nextFirstKey = this.firstKeys[candidateIndex];
            const nextLastKey = this.lastKeys[candidateIndex];
            if (tailKey === nextFirstKey) {
                return { next, mergeType: MergeType.EndStart };
            }
            if (tailKey === nextLastKey) {
                return { next, mergeType: MergeType.EndEnd };
            }
            if (headKey === nextFirstKey) {
                return { next, mergeType: MergeType.StartStart };
            }
            if (headKey === nextLastKey) {
                return { next, mergeType: MergeType.StartEnd };
            }
        }

        // Step 2: Fallback to map-based lookup if no sequential match
        const fromFirst = getFirstFromMap(this.firstMap, tailKey);
        if (fromFirst) {
            return { next: fromFirst, mergeType: MergeType.EndStart };
        }
        const fromLast = getFirstFromMap(this.lastMap, tailKey);
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
