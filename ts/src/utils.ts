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

export const pointInsidePolygon = (pt: number[], polygon: number[][], xIdx?: number, yIdx?: number): boolean => {
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






