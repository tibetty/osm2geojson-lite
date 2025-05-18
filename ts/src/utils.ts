import type { Way } from './way';

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

export function addToMap<T>(m: { [k: string]: T[] }, k: string, v: T): void {
    const a = m[k];
    if (a) {
        a.push(v);
    } else {
        m[k] = [v];
    }
}

export function removeFromMap<T>(m: { [k: string]: T[] }, k: string, v: T): void {
    const a = m[k];
    let idx = -1;
    if (a) {
        idx = a.indexOf(v);
    }
    if (idx >= 0) {
        a.splice(idx, 1);
    }
}

export function getFirstFromMap<T>(m: { [k: string]: T[] }, k: string): T | null {
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

export class WayCollection extends Array {
    private firstMap: { [k: string]: any };
    private lastMap: { [k: string]: any };

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

    public toStrings(): number[][][] {
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
