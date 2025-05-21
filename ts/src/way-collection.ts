import { addToMap, coordsToKey, first, getFirstFromMap, isRing, last, removeFromMap, ringDirection, strArrayArrayToFloat } from "./utils";
import type { Way } from "./way";

const enum MergeType {
    EndStart,
    EndEnd,
    StartStart,
    StartEnd
}

export class WayCollection extends Array {
    private firstMap: Record<string, string[][][]>;
    private lastMap: Record<string, string[][][]>;

    constructor() {
        super();
        this.firstMap = {};
        this.lastMap = {};
    }

    public addWay(way: Way) {
        const w = way.toCoordsArray();
        if (w.length > 0) {
            this.push(w);
            addToMap(this.firstMap, coordsToKey(first(w)), w);
            addToMap(this.lastMap, coordsToKey(last(w)), w);
        }
    }

    public mergeWays(): number[][][] {
        const strings: number[][][] = [];
        let way: string[][] = this.shift();
        while (way) {
            removeFromMap(this.firstMap, coordsToKey(first(way)), way);
            removeFromMap(this.lastMap, coordsToKey(last(way)), way);
            let current = way;
            let next: string[][] | null;
            do {
                let nextWay = this.getNextWay(current);
                next = nextWay.next;
                let mergeType = nextWay.mergeType;
                if (!next) {
                    continue;
                }
                this.splice(this.indexOf(next), 1);
                removeFromMap(this.firstMap, coordsToKey(first(next)), next);
                removeFromMap(this.lastMap, coordsToKey(last(next)), next);
                switch (mergeType) {
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
                        break;
                }
            } while (next);
            strings.push(strArrayArrayToFloat(current));
            way = this.shift();
        }

        return strings;
    }

    /**
     * Try to find the next way to add to the current way.
     * It first tries the next way in the array, and if this doesn't work, try any other way.
     */
    private getNextWay(current: string[][]): { next: string[][] | null; mergeType: MergeType } {
        const lastKey = coordsToKey(last(current));
        const firstKey = coordsToKey(first(current));

        // Step 1: Prefer the next way in the array if it connects
        let next: string[][] | null = this.length > 0 ? this[0] : null;
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
        next = getFirstFromMap(this.firstMap, lastKey);
        if (next) {
            return { next, mergeType: MergeType.EndStart };
        }
        next = getFirstFromMap(this.lastMap, lastKey);
        return { next, mergeType: MergeType.EndEnd };
    }
    
    public toRings(direction: string): number[][][] {
        const strings = this.mergeWays();
        const rings: number[][][] = [];
        let str = strings.shift();
        while (str) {
            if (isRing(str)) {
                if (ringDirection(str) !== direction) {
                    str.reverse();
                }
                rings.push(str);
            }
            str = strings.shift();
        }
        return rings;
    }
}
