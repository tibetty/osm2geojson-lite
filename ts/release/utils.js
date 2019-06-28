"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function purgeProps(obj, blacklist) {
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
exports.purgeProps = purgeProps;
function mergeProps(obj1, obj2) {
    obj1 = obj1 ? obj1 : {};
    obj2 = obj2 ? obj2 : {};
    return Object.assign(obj1, obj2);
}
exports.mergeProps = mergeProps;
function addPropToFeature(f, k, v) {
    if (f.properties && k && v) {
        f.properties[k] = v;
    }
}
exports.addPropToFeature = addPropToFeature;
function addPropToFeatures(fs, k, v) {
    for (const f of fs) {
        addPropToFeature(f, k, v);
    }
}
exports.addPropToFeatures = addPropToFeatures;
exports.first = (a) => a[0];
exports.last = (a) => a[a.length - 1];
exports.coordsToKey = (a) => a.join(',');
function addToMap(m, k, v) {
    const a = m[k];
    if (a) {
        a.push(v);
    }
    else {
        m[k] = [v];
    }
}
exports.addToMap = addToMap;
function removeFromMap(m, k, v) {
    const a = m[k];
    let idx = -1;
    if (a) {
        idx = a.indexOf(v);
    }
    if (idx >= 0) {
        a.splice(idx, 1);
    }
}
exports.removeFromMap = removeFromMap;
function getFirstFromMap(m, k) {
    const a = m[k];
    if (a && a.length > 0) {
        return a[0];
    }
    return undefined;
}
exports.getFirstFromMap = getFirstFromMap;
// need 3+ different points to form a ring, here using > 3 is 'coz a the first and the last points are actually the same
exports.isRing = (a) => a.length > 3 && exports.coordsToKey(exports.first(a)) === exports.coordsToKey(exports.last(a));
exports.ringDirection = (a, xIdx, yIdx) => {
    xIdx = xIdx || 0, yIdx = yIdx || 1;
    // get the index of the point which has the maximum x value
    const m = a.reduce((maxxIdx, v, idx) => a[maxxIdx][xIdx || 0] > v[xIdx || 0] ? maxxIdx : idx, 0);
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
exports.ptInsidePolygon = (pt, polygon, xIdx, yIdx) => {
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
exports.strToFloat = (el) => el instanceof Array ? el.map(exports.strToFloat) : parseFloat(el);
class LateBinder {
    constructor(container, valueFunc, ctx, args) {
        this.container = container;
        this.valueFunc = valueFunc;
        this.ctx = ctx;
        this.args = args;
    }
    bind() {
        const v = this.valueFunc.apply(this.ctx, this.args);
        if (this.container instanceof Array) {
            const idx = this.container.indexOf(this);
            if (idx >= 0) {
                const args = [idx, 1];
                if (v) {
                    args.push(v);
                }
                [].splice.apply(this.container, args);
            }
        }
        else if (typeof this.container === 'object') {
            const k = Object.keys(this.container).find((nv) => this.container[nv] === this);
            if (k) {
                if (v) {
                    this.container[k] = v;
                }
                else {
                    delete this.container[k];
                }
            }
        }
    }
}
exports.LateBinder = LateBinder;
class RefElements extends Map {
    constructor() {
        super();
        this.binders = [];
    }
    add(k, v) {
        this.set(k, v);
    }
    addBinder(binder) {
        this.binders.push(binder);
    }
    bindAll() {
        this.binders.forEach((binder) => binder.bind());
    }
}
exports.RefElements = RefElements;
class WayCollection extends Array {
    constructor() {
        super();
        this.firstMap = {};
        this.lastMap = {};
    }
    addWay(way) {
        const w = way.toCoordsArray();
        if (w.length > 0) {
            this.push(way);
            addToMap(this.firstMap, exports.coordsToKey(exports.first(w)), w);
            addToMap(this.lastMap, exports.coordsToKey(exports.last(w)), w);
        }
    }
    toStrings() {
        const strings = [];
        let way = this.shift();
        while (way) {
            removeFromMap(this.firstMap, exports.coordsToKey(exports.first(way)), way);
            removeFromMap(this.lastMap, exports.coordsToKey(exports.last(way)), way);
            let current = way;
            let next;
            do {
                const key = exports.coordsToKey(exports.last(current));
                let shouldReverse = false;
                next = getFirstFromMap(this.firstMap, key);
                if (!next) {
                    next = getFirstFromMap(this.lastMap, key);
                    shouldReverse = true;
                }
                if (next) {
                    this.splice(this.indexOf(next), 1);
                    removeFromMap(this.firstMap, exports.coordsToKey(exports.first(next)), next);
                    removeFromMap(this.lastMap, exports.coordsToKey(exports.last(next)), next);
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
            strings.push(exports.strToFloat(current));
            way = this.shift();
        }
        return strings;
    }
    toRings(direction) {
        const strings = this.toStrings();
        const rings = [];
        let str = strings.shift();
        while (str) {
            if (exports.isRing(str)) {
                if (exports.ringDirection(str) !== direction) {
                    str.reverse();
                }
                rings.push(str);
            }
            str = strings.shift();
        }
        return rings;
    }
}
exports.WayCollection = WayCollection;
