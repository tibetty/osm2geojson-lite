import { addToMap, boundsToRing, coordsToKey, first, isRing, last, ringDirection } from "./utils";
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
    private firstHeads: Record<string, number>;
    private lastHeads: Record<string, number>;
    private used: boolean[];
    private indexByWay: Map<number[][], number>;
    private head: number;

    constructor() {
        this.ways = [];
        this.firstKeys = [];
        this.lastKeys = [];
        this.firstMap = {};
        this.lastMap = {};
        this.firstHeads = {};
        this.lastHeads = {};
        this.used = [];
        this.indexByWay = new Map();
        this.head = 0;
    }

    public addWay(way: Way) {
        let w = way.toCoordsArray();
        if (w.length === 0) {
            const bounds = way.getBounds();
            if (bounds) {
                w = boundsToRing(bounds);
            }
        }
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
    }

    /**
     * Find the first unconsumed way in an endpoint bucket.
     *
     * Consumed entries are left in the bucket instead of being spliced out.
     * The per-key cursor makes the amortised cost O(1) even when many ways
     * share the same endpoint, while preserving insertion order.
     */
    private firstUnusedFromMap(
        map: Record<string, number[][][]>,
        heads: Record<string, number>,
        key: string,
    ): number[][] | null {
        const bucket = map[key];
        if (!bucket) {
            return null;
        }
        let index = heads[key] || 0;
        while (index < bucket.length) {
            const way = bucket[index];
            const wayIndex = this.indexByWay.get(way);
            if (wayIndex !== undefined && !this.used[wayIndex]) {
                heads[key] = index;
                return way;
            }
            index++;
        }
        heads[key] = index;
        return null;
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

        // Step 2: Fallback to map-based lookup if no sequential match.
        // Prefer extending the tail, then try the head (a later member may
        // join the front while the next array entry is disconnected).
        const fromFirst = this.firstUnusedFromMap(this.firstMap, this.firstHeads, tailKey);
        if (fromFirst) {
            return { next: fromFirst, mergeType: MergeType.EndStart };
        }
        const fromLast = this.firstUnusedFromMap(this.lastMap, this.lastHeads, tailKey);
        if (fromLast) {
            return { next: fromLast, mergeType: MergeType.EndEnd };
        }
        const headFirst = this.firstUnusedFromMap(this.firstMap, this.firstHeads, headKey);
        if (headFirst) {
            return { next: headFirst, mergeType: MergeType.StartStart };
        }
        const headLast = this.firstUnusedFromMap(this.lastMap, this.lastHeads, headKey);
        return { next: headLast, mergeType: MergeType.StartEnd };
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
