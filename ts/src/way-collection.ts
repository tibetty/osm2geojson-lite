import { addToMap, coordsToKey, first, getFirstFromMap, isRing, last, removeFromMap, ringDirection, strArrayArrayToFloat } from "./utils";
import type { Way } from "./way";

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
                const key = coordsToKey(last(current));
                let shouldReverse = false;

                next = getFirstFromMap(this.firstMap, key);
                if (!next) {
                    next = getFirstFromMap(this.lastMap, key);
                    shouldReverse = true;
                }

                if (next) {
                    this.splice(this.indexOf(next), 1);
                    removeFromMap(this.firstMap, coordsToKey(first(next)), next);
                    removeFromMap(this.lastMap, coordsToKey(last(next)), next);
                    if (shouldReverse) {
                        // always reverse shorter one to save time
                        if (next.length > current.length) {
                            [current, next] = [next, current];
                        }
                        next.reverse();
                    }

                    current = current.concat(next.slice(1));
                }
            } while (next);
            strings.push(strArrayArrayToFloat(current));
            way = this.shift();
        }

        return strings;
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