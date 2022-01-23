module.exports = (() => {
	'use strict';

	const purgeProps = (obj, blacklist) => {
		if (obj) {
			let rs = Object.assign({}, obj);
			if (blacklist) {
				for (let prop of blacklist) {
					delete rs[prop];
				}
			}
			return rs;
		}
		return {};
	}

	const mergeProps = (obj1, obj2) => {
		obj1 = obj1? obj1 : {};
		obj2 = obj2? obj2 : {};
		return Object.assign(obj1, obj2);
	}

	const addPropToFeature = (f, k, v) => {
		if (f.properties && k && v) {
			f.properties[k] = v;
		}
	}

	const addPropToFeatures = (fs, k, v) => {
		for (let f of fs) {
			addPropToFeature(f, k, v);
		}
	}

	const first = a => a[0];
	const last = a => a[a.length - 1];
	const coordsToKey = a => a.join(',');

	const addToMap = (m, k, v) => {
		let a = m[k];
		if (a) {
			a.push(v);
		} else {
			m[k] = [v];
		}
	}
	
	const removeFromMap = (m, k, v) => {
		let a = m[k];
		let idx = null;
		if (a && (idx = a.indexOf(v)) >= 0) {
			a.splice(idx, 1);
		}
	}
	
	const getFirstFromMap = (m, k) => {
		let a = m[k];
		if (a && a.length > 0) {
			return a[0];
		}
		return null;
	}

	// need 3+ different points to form a ring, here using > 3 is 'coz a the first and the last points are actually the same
	const isRing = a => a.length > 3 && coordsToKey(first(a)) === coordsToKey(last(a));

	const ringDirection = (a, xIdx, yIdx) => {
		xIdx = xIdx || 0, yIdx = yIdx || 1;
		// get the index of the point which has the maximum x value
		let m = a.reduce((maxxIdx, v, idx) => a[maxxIdx][xIdx] > v[xIdx] ? maxxIdx : idx, 0);
		// 'coz the first point is virtually the same one as the last point, 
		// we need to skip a.length - 1 for left when m = 0,
		// and skip 0 for right when m = a.length - 1;
		let l = m <= 0? a.length - 2 : m - 1, r = m >= a.length - 1? 1 : m + 1;
		let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
		let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
		let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
		return det < 0 ? 'clockwise' : 'counterclockwise';
	}

	const ptInsidePolygon = (pt, polygon, xIdx, yIdx) => {
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
	}

	const strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);
	
	class RefElements extends Map {
		constructor() {
			super();
			this.binders = [];
		}

		add(k, v) {
			if (!this.has(k)) {
				this.set(k, v);
			}
			// suppress duplcated key error
			// else
			// throw `Error: adding duplicated key '${k}' to RefElements`;
		}

		addBinder(binder) {
			this.binders.push(binder);
		}

		bindAll() {
			this.binders.forEach(binder => binder.bind());
		}
	}

	class LateBinder {
		constructor(container, valueFunc, ctx, args) {
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
					if (v) {
						args.push(v);
					}
					[].splice.apply(this.container, args);
				}
			} else if (typeof this.container === 'object') {
				let k = Object.keys(this.container).find(v => this.container[v] === this);
				if (k) {
					if (v) {
						this.container[k] = v;
					} else {
						delete this.container[k];
					}
				}
			}
		}
	}

	class WayCollection extends Array {
		constructor() {
			super();
			this.firstMap = {};
			this.lastMap = {};
		}

		addWay(way) {
			way = way.toCoordsArray();
			if (way.length > 0) {
				this.push(way);
				addToMap(this.firstMap, coordsToKey(first(way)), way);
				addToMap(this.lastMap, coordsToKey(last(way)), way);
			}
		}

		toStrings() {
			let strings = [], way = null;
			while (way = this.shift()) {
				removeFromMap(this.firstMap, coordsToKey(first(way)), way);
				removeFromMap(this.lastMap, coordsToKey(last(way)), way);
				let current = way, next = null;
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
							if (next.length > current.length) {
								[current, next] = [next, current];
							}
							next.reverse();
						}

						current = current.concat(next.slice(1));
					}
				} while (next);
				strings.push(strToFloat(current));
			}

			return strings;
		}

		toRings(direction) {
			let strings = this.toStrings();
			let rings = [], string = null;
			while (string = strings.shift()) {
				if (isRing(string)) {
					if (ringDirection(string) !== direction) {
						string.reverse();
					}
					rings.push(string);
				}	
			}
			return rings;
		}
	}

	return {purgeProps, mergeProps,
		first, last, coordsToKey,
		addToMap, removeFromMap, getFirstFromMap,
		isRing, ringDirection, ptInsidePolygon, strToFloat,
		RefElements, LateBinder, WayCollection};
})();
