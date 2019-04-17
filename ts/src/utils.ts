import {Way} from "./osmobjs";

export function purgeProps(obj: {[k: string]: any}, blacklist: string[]): {[k: string]: any} {
	if (obj) {
		let rs = Object.assign({}, obj);
		if (blacklist)
			for (let prop of blacklist) delete rs[prop];
		return rs;
	}
	return {};
}

export function mergeProps(obj1: {[k: string]: any}, obj2: {[k: string]: any}): {[k: string]: any} {
	obj1 = obj1? obj1 : {};
	obj2 = obj2? obj2 : {};
	return Object.assign(obj1, obj2);
}

export function addPropToFeature(f: {[k: string]: any}, k: string, v: any) {
	if (f.properties && k && v) f.properties[k] = v;
}

export function addPropToFeatures(fs: {[k: string]: any}[], k: string, v: any) {
	for (let f of fs) addPropToFeature(f, k, v);
}

export const first = (a: any[]): any => a[0];
export const last = (a: any[]): any => a[a.length - 1];
export const coordsToKey = (a: number[]): any => a.join(',');

export function addToMap(m: {[k: string]: any}, k: string, v: any): void {
	let a = m[k];
	if (a) a.push(v);
	else m[k] = [v];
}

export function removeFromMap(m: {[k: string]: any}, k: string, v: any): void {
	let a = m[k];
	let idx = null;
	if (a && (idx = a.indexOf(v)) >= 0)
		a.splice(idx, 1);
}

export function getFirstFromMap(m: {[k: string]: any}, k: string): any {
	let a = m[k];
	if (a && a.length > 0) return a[0];
	return null;
}

// need 3+ different points to form a ring, here using > 3 is 'coz a the first and the last points are actually the same
export const isRing = (a: number[][]): boolean => a.length > 3 && coordsToKey(first(a)) === coordsToKey(last(a));

export const ringDirection = (a: number[][], xIdx?: number, yIdx?: number): string => {
	xIdx = xIdx || 0, yIdx = yIdx || 1;
	// get the index of the point which has the maximum x value
	let m = a.reduce((maxxIdx: number, v: number[], idx: number): number => a[maxxIdx][xIdx || 0] > v[xIdx || 0] ? maxxIdx : idx, 0);
	// 'coz the first point is virtually the same one as the last point, 
	// we need to skip a.length - 1 for left when m = 0,
	// and skip 0 for right when m = a.length - 1;
	let l = m <= 0? a.length - 2 : m - 1, r = m >= a.length - 1? 1 : m + 1;
	let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
	let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
	let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
	return det < 0 ? 'clockwise' : 'counterclockwise';
}

export const ptInsidePolygon = (pt: number[], polygon: number[][], xIdx?: number, yIdx?: number): boolean => {
	xIdx = xIdx || 0, yIdx = yIdx || 1;
	let result = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		if ((polygon[i][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[j][xIdx] ||
			polygon[j][xIdx] <= pt[xIdx] && pt[xIdx] < polygon[i][xIdx]) &&
			pt[yIdx] < (polygon[j][yIdx] - polygon[i][yIdx]) * (pt[xIdx] - polygon[i][xIdx]) / (polygon[j][xIdx] - polygon[i][xIdx]) + polygon[i][yIdx])
			result = !result;
	}
	return result;
}

export const strToFloat = (el: string[] | string): any => el instanceof Array? el.map(strToFloat) : parseFloat(el);

export class LateBinder {
	container: any[] | {[k: string]: any};
	valueFunc: (...args) => any;
	ctx: any;
	args: any[];

	constructor(container: any[] | {[k: string]: any}, valueFunc: (...args) => any, ctx: any, args: any[]) {
		this.container = container;
		this.valueFunc = valueFunc;
		this.ctx = ctx;
		this.args = args;
	}

	bind() {
		let v = this.valueFunc.apply(this.ctx, this.args);
		if (this.container instanceof Array) {
			let idx = this.container.indexOf(this);
			if (idx >= 0) {
				let args = [idx, 1];
				if (v) args.push(v);
				[].splice.apply(this.container, args);
			}
		} else if (typeof this.container === 'object') {
			let k = Object.keys(this.container).find(v => this.container[v] === this);
			if (k)
				if (v) this.container[k] = v;
				else delete this.container[k];
		}
	}
}

export class RefElements extends Map {
	binders: LateBinder[];

	constructor() {
		super();
		this.binders = [];
	}

	add(k: String, v: Object) {
		this.set(k, v);
	}

	addBinder(binder: LateBinder) {
		this.binders.push(binder);
	}

	bindAll() {
		this.binders.forEach(binder => binder.bind());
	}
}

export class WayCollection extends Array {
	firstMap: {[k: string]: any};
	lastMap: {[k: string]: any};

	constructor() {
		super();
		this.firstMap = {};
		this.lastMap = {};
	}

	addWay(way: Way) {
		let w = way.toCoordsArray();
		if (w.length > 0) {
			this.push(way);
			addToMap(this.firstMap, coordsToKey(first(w)), w);
			addToMap(this.lastMap, coordsToKey(last(w)), w);
		}
	}

	toStrings(): number[][][] {
		let strings: any[] = [], way = null;
		while (way = this.shift()) {
			removeFromMap(this.firstMap, coordsToKey(first(way)), way);
			removeFromMap(this.lastMap, coordsToKey(last(way)), way);
			let current: any[] = way, next: any[];
			do {
				let key = coordsToKey(last(current)), shouldReverse = false;

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
						if (next.length > current.length)
							[current, next] = [next, current];
						next.reverse();
					}

					current = current.concat(next.slice(1));
				}
			} while (next);
			strings.push(strToFloat(current));
		}

		return strings;
	}

	toRings(direction: string): number[][][] {
		let strings = this.toStrings();
		let rings: number[][][] = [], str: number[][] | undefined;
		while (str = strings.shift()) {
			if (isRing(str)) {
				if (ringDirection(str) !== direction) str.reverse();
				rings.push(str);
			}	
		}
		return rings;
	}
}
