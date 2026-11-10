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

export function first<T>(a: T[]): T { return  a[0] }
export function last<T>(a: T[]): T { return a[a.length - 1]}
export function coordsToKey<T>(a: T[]): string { return a.join(',')}

/**
 * Whether a lat/lon pair can be emitted as a finite GeoJSON position.
 * Accepts numeric strings because Overpass XML stores attributes as strings.
 */
export function isFiniteCoordinate(lat: unknown, lon: unknown): boolean {
    if ((typeof lat !== 'number' && typeof lat !== 'string') ||
        (typeof lon !== 'number' && typeof lon !== 'string') ||
        lat === '' || lon === '') {
        return false;
    }
    return Number.isFinite(+lat) && Number.isFinite(+lon);
}

/** Whether `[minlon, minlat, maxlon, maxlat]` is a usable bounding box. */
export function isFiniteBounds(bounds: unknown): boolean {
    if (!Array.isArray(bounds) || bounds.length < 4) {
        return false;
    }
    for (let i = 0; i < 4; i++) {
        const value = bounds[i];
        if ((typeof value !== 'number' && typeof value !== 'string') ||
            value === '' || !Number.isFinite(+value)) {
            return false;
        }
    }
    return true;
}

export function addToMap<T>(m: { [k: string]: T[] }, k: string, v: T): void {
    const a = m[k];
    if (a) {
        a.push(v);
    } else {
        m[k] = [v];
    }
}

// need 3+ different points to form a ring, here using > 3 is 'coz a the first and the last points are actually the same
export function isRing(a: number[][]): boolean {
    if (a.length <= 3) {
        return false;
    }
    const firstPoint = a[0];
    const lastPoint = a[a.length - 1];
    return firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1];
}

/**
 * Build the closed rectangle used by Overpass `out bb` responses when an
 * element carries only a bounding box.
 * @param bounds `[minlon, minlat, maxlon, maxlat]`
 */
export function boundsToRing(bounds: number[]): number[][] {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    return [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
    ];
}

export interface RingBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/**
 * Bounds produced by `ringDirection` while it already scans the ring. Polygon
 * assembly needs both, so reusing that pass avoids a second full scan on
 * relation-heavy data.
 */
const ringBoundsCache = new WeakMap<number[][], RingBounds>();

export function ringDirection(a: number[][], xIdx?: number, yIdx?: number): string {
    xIdx = xIdx === undefined ? 0 : xIdx;
    yIdx = yIdx === undefined ? 1 : yIdx;
    // get the index of the point which has the maximum x value, while also
    // collecting the bounding box in the same pass
    let m = 0;
    let maxX = a[0][xIdx];
    let minX = maxX;
    let minY = a[0][yIdx];
    let maxY = minY;
    for (let idx = 1; idx < a.length; idx++) {
        const point = a[idx];
        const x = point[xIdx];
        const y = point[yIdx];
        if (x >= maxX) {
            maxX = x;
            m = idx;
        } else if (x < minX) {
            minX = x;
        }
        if (y < minY) {
            minY = y;
        } else if (y > maxY) {
            maxY = y;
        }
    }
    if (xIdx === 0 && yIdx === 1) {
        ringBoundsCache.set(a, { minX, maxX, minY, maxY });
    }
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

export function ringBounds(ring: number[][]): RingBounds {
    const cached = ringBoundsCache.get(ring);
    if (cached) {
        return cached;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
        const point = ring[i];
        const x = point[0];
        const y = point[1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const bounds = { minX, maxX, minY, maxY };
    ringBoundsCache.set(ring, bounds);
    return bounds;
}

export function pointInsidePolygon(pt: number[], polygon: number[][], xIdx?: number, yIdx?: number): boolean {
    xIdx = xIdx === undefined ? 0 : xIdx;
    yIdx = yIdx === undefined ? 1 : yIdx;
    const px = pt[xIdx];
    const py = pt[yIdx];
    let result = false;
    let xj = polygon[polygon.length - 1][xIdx];
    let yj = polygon[polygon.length - 1][yIdx];
    for (let i = 0; i < polygon.length; i++) {
        const point = polygon[i];
        const xi = point[xIdx];
        const yi = point[yIdx];
        if ((xi <= px && px < xj || xj <= px && px < xi) &&
            py < (yj - yi) * (px - xi) / (xj - xi) + yi) {
            result = !result;
        }
        xj = xi;
        yj = yi;
    }
    return result;
};

export function strArrayArrayToFloat(el: string[][]): number[][] {
    return el.map(strArrayToFloat);
}

export function strArrayToFloat(el: string[]): number[] {
    return el.map(parseFloat);
}






