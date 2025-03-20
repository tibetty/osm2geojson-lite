import { Way } from './osmobjs';

export function purgeProps(obj: { [k: string]: any }, blacklist: string[]): { [k: string]: any } {
    if (obj) {
        const rs = Object.assign({}, obj);
        if (blacklist) {
            for (const prop of blacklist) {
                delete rs[prop];
            }
        }
        return rs;
    }
    return {};
}

export function mergeProps(obj1: { [k: string]: any }, obj2: { [k: string]: any }): { [k: string]: any } {
    obj1 = obj1 ? obj1 : {};
    obj2 = obj2 ? obj2 : {};
    return Object.assign(obj1, obj2);
}

export function addPropToFeature(f: { [k: string]: any }, k: string, v: any) {
    if (f.properties && k && v) {
        f.properties[k] = v;
    }
}

export function addPropToFeatures(fs: Array<{ [k: string]: any }>, k: string, v: any) {
    for (const f of fs) {
        addPropToFeature(f, k, v);
    }
}

export const first = <T>(a: T[]): T => a[0];
export const last = <T>(a: T[]): T => a[a.length - 1];
export const coordsToKey = <T>(a: T[]): string => a.join(',');

function addToMap<T>(m: { [k: string]: T[] }, k: string, v: T): void {
    const a = m[k];
    if (a) {
        a.push(v);
    } else {
        m[k] = [v];
    }
}

function removeFromMap<T>(m: { [k: string]: T[] }, k: string, v: T): void {
    const a = m[k];
    let idx = -1;
    if (a) {
        idx = a.indexOf(v);
    }
    if (idx >= 0) {
        a.splice(idx, 1);
    }
}

function getFirstFromMap<T>(m: { [k: string]: T[] }, k: string): T | null {
    const a = m[k];
    if (a && a.length > 0) {
        return a[0];
    }
    return null;
}

// need 3+ different points to form a ring, here using > 3 is 'coz a the first and the last points are actually the same
export const isRing = (a: number[][]): boolean => a.length > 3 && coordsToKey(first(a)) === coordsToKey(last(a));

export const ringDirection = (a: number[][], xIdx?: number, yIdx?: number): string => {
    xIdx = xIdx || 0, yIdx = yIdx || 1;
    // get the index of the point which has the maximum x value
    const m = a.reduce((maxxIdx: number, v: number[], idx: number): number => a[maxxIdx][xIdx || 0] > v[xIdx || 0] ? maxxIdx : idx, 0);
    // 'coz the first point is virtually the same one as the last point,
    // we need to skip a.length - 1 for left when m = 0,
    // and skip 0 for right when m = a.length - 1;
    const l = m <= 0 ? a.length - 2 : m - 1;
    const r = m >= a.length - 1 ? 1 : m + 1;
    const xa = a[l][xIdx];
    const xb = a[m][xIdx];
    const xc = a[r][xIdx];
    const ya = a[l][yIdx];
    const yb = a[m][yIdx];
    const yc = a[r][yIdx];
    const det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
    return det < 0 ? 'clockwise' : 'counterclockwise';
};

export const ptInsidePolygon = (pt: number[], polygon: number[][], xIdx?: number, yIdx?: number): boolean => {
    xIdx = xIdx || 0, yIdx = yIdx || 1;
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if ((polygon[i][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[j][xIdx] ||
            polygon[j][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[i][xIdx]) &&
            pt[yIdx] < (polygon[j][yIdx] - polygon[i][yIdx]) * (pt[xIdx] - polygon[i][xIdx]) / (polygon[j][xIdx] - polygon[i][xIdx]) + polygon[i][yIdx]) {
            result = !result;
        }
    }
    return result;
};

export const strToFloat = (el: any[] | string): any => el instanceof Array ? el.map(strToFloat) : parseFloat(el);

export class LateBinder {
    private container: any[] | { [k: string]: any };
    private valueFunc: (...args: any[]) => any;
    private ctx: any;
    private args: any[];

    constructor(container: any[] | { [k: string]: any }, valueFunc: (...args: any[]) => any, ctx: any, args: any[]) {
        this.container = container;
        this.valueFunc = valueFunc;
        this.ctx = ctx;
        this.args = args;
    }

    public bind() {
        const v = this.valueFunc.apply(this.ctx, this.args);
        if (this.container instanceof Array) {
            const idx = this.container.indexOf(this);
            if (idx >= 0) {
                const args: [number, number, any?] = [idx, 1];
                if (v) {
                    args.push(v);
                }
                Array.prototype.splice.apply(this.container, args);
            }
        } else if (typeof this.container === 'object' && !Array.isArray(this.container)) {
            const container = this.container as { [k: string]: any };
            const k = Object.keys(container).find((nv) => container[nv] === this);
            if (k) {
                if (v) {
                    container[k] = v;
                } else {
                    delete container[k];
                }
            }
        }
    }
}

export class RefElements extends Map {
    private binders: LateBinder[];

    constructor() {
        super();
        this.binders = [];
    }

    public add(k: string, v: any) {
        this.set(k, v);
    }

    public addBinder(binder: LateBinder) {
        this.binders.push(binder);
    }

    public bindAll() {
        this.binders.forEach((binder) => binder.bind());
    }
}

export class WayCollection extends Array<number[][]> {
    private firstMap: { [k: string]: number[][][] };
    private lastMap: { [k: string]: number[][][] };

    constructor() {
        super();
        this.firstMap = {};
        this.lastMap = {};
    }

    public addWay(way: Way) {
        const w = way.toCoordsArray();
        if (w.length > 0) {
            const nw = strToFloat(w);
            this.push(nw);
            addToMap(this.firstMap, coordsToKey<number[]>(first(nw)), nw);
            addToMap(this.lastMap, coordsToKey<number[]>(last(nw)), nw);
        }
    }

    public toStrings(): number[][][] {
        const strings: number[][][] = [];
        let way: number[][] | undefined = this.shift();
        while (way) {
            removeFromMap(this.firstMap, coordsToKey(first(way)), way);
            removeFromMap(this.lastMap, coordsToKey(last(way)), way);
            let current = way;
            let next: number[][] | null;
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
            strings.push(strToFloat(current));
            way = this.shift();
        }

        return strings;
    }

    public toRings(direction: string): number[][][] {
        const strings = this.toStrings();
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

export class OptimalWayCollection extends WayCollection {
    public toOptimalStrings(): number[][][] {
        // Clone the current collection to avoid modifying original data
        const tempCollection = new WayCollection();
        this.forEach(way => tempCollection.push([...way]));
        
        // First map for quick access to ways by their first node
        const firstMap: { [k: string]: number[][] [] } = {};
        // Last map for quick access to ways by their last node
        const lastMap: { [k: string]: number[][] [] } = {};
        
        // Populate the maps
        tempCollection.forEach(way => {
            addToMap(firstMap, coordsToKey(first(way)), way);
            addToMap(lastMap, coordsToKey(last(way)), way);
        });
        
        const strings: number[][][] = [];
        const processedWays = new Set();
        
        // Process each way as a potential starting point
        while (tempCollection.length > 0) {
            let longestString: number[][] | null = null;
            let bestStartWay: number[][] | null = null;
            
            // Try each way as a starting point
            for (const startWay of tempCollection) {
                if (processedWays.has(startWay)) continue;
                
                // Create a temporary collection to simulate processing from this starting way
                const testCollection = new WayCollection();
                tempCollection.forEach(way => {
                    if (way !== startWay && !processedWays.has(way)) {
                        testCollection.push([...way]);
                    }
                });
                
                // Start with this way
                let current = [...startWay];
                let foundConnection = true;
                
                // Iteratively find connecting ways
                while (foundConnection) {
                    foundConnection = false;
                    
                    // Try to find a way connecting at the end
                    const endKey = coordsToKey(last(current));
                    let nextWay: number[][] | null = getFirstFromMap(firstMap, endKey);
                    let shouldReverse = false;
                    
                    if (!nextWay) {
                        nextWay = getFirstFromMap(lastMap, endKey);
                        shouldReverse = true;
                    }
                    
                    if (nextWay && !processedWays.has(nextWay)) {
                        // Found a way to extend the current string
                        processedWays.add(nextWay);
                        testCollection.splice(testCollection.indexOf(nextWay), 1);
                        
                        if (shouldReverse) {
                            nextWay = [...nextWay].reverse();
                        }
                        
                        current = current.concat(nextWay.slice(1));
                        foundConnection = true;
                    }
                }
                
                // Check if this is the longest string found so far
                if (!longestString || current.length > longestString.length) {
                    longestString = current;
                    bestStartWay = startWay;
                }
                
                // Clear the processed set for the next trial
                processedWays.clear();
            }
            
            // Add the longest string found to the result
            if (longestString) {
                strings.push(strToFloat(longestString));
                
                // Remove all ways that were used in this string
                tempCollection.splice(tempCollection.indexOf(bestStartWay!), 1);
                processedWays.add(bestStartWay);
                
                // Also remove any other ways that were connected to form this string
                // This requires tracing the path again
                let current = bestStartWay!;
                let foundConnection = true;
                
                while (foundConnection) {
                    foundConnection = false;
                    
                    const endKey = coordsToKey(last(current));
                    let nextWay: number[][] | null = getFirstFromMap(firstMap, endKey);
                    let shouldReverse = false;
                    
                    if (!nextWay) {
                        nextWay = getFirstFromMap(lastMap, endKey);
                        shouldReverse = true;
                    }
                    
                    if (nextWay && tempCollection.includes(nextWay)) {
                        tempCollection.splice(tempCollection.indexOf(nextWay), 1);
                        processedWays.add(nextWay);
                        
                        if (shouldReverse) {
                            nextWay = [...nextWay].reverse();
                        }
                        
                        current = current.concat(nextWay.slice(1));
                        foundConnection = true;
                    }
                }
            } else {
                // Should not happen, but just in case
                break;
            }
        }
        
        return strings;
    }
    
    public toOptimalRings(direction: string): number[][][] {
        const strings = this.toOptimalStrings();
        const rings: number[][][] = [];
        
        for (const str of strings) {
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