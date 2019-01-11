module.exports = (() => {
	'use strict';

	let first = a => a[0];
	let last = a => a[a.length - 1];
	let coordsToKey = a => a.join(',');

	let addToMap = (m, k, v) => {
		let a = m[k];
		if (a) a.push(v);
		else m[k] = [v];
	}
	
	let removeFromMap = (m, k, v) => {
		let a = m[k];
		if (a) a.splice(a.indexOf(v), 1);
	}
	
	let getFirstFromMap = (m, k) => {
		let a = m[k];
		if (a && a.length > 0) return a[0];
		return null;
	}

	let isRing = a => (a.length > 2 && coordsToKey(first(a)) === coordsToKey(last(a)));

	let ringDirection = (a, xIdx, yIdx) => {
		xIdx = xIdx || 0, yIdx = yIdx || 1;
		let m = a.reduce((maxxIdx, v, idx) => a[maxxIdx][xIdx] > v[xIdx] ? maxxIdx : idx, 0);
		let l = m <= 0? a.length - 1 : m - 1, r = m >= a.length - 1? 0 : m + 1;
		let xa = a[l][xIdx], xb = a[m][xIdx], xc = a[r][xIdx];
		let ya = a[l][yIdx], yb = a[m][yIdx], yc = a[r][yIdx];
		let det = (xb - xa) * (yc - ya) - (xc - xa) * (yb - ya);
		return det < 0 ? 'clockwise' : 'counterclockwise';
	}

	let ptInsidePolygon = (pt, polygon, xIdx, yIdx) => {
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

	let strToFloat = el => el instanceof Array? el.map(strToFloat) : parseFloat(el);
	
	class RefElements {
		add(k, v) {
			this[k] = v;
		}

		cleanup() {
			let entries = Object.entries(this);
			for (let [k, v] of entries) {
				if (v && v.unlinkRef) v.unlinkRef();
				delete this[k];
			}
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
				let args = [this.container.indexOf(this), 1];
				if (v) args.push(v);
				[].splice.apply(this.container, args);
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
			this.push(way);
			addToMap(this.firstMap, coordsToKey(first(way)), way);
			addToMap(this.lastMap, coordsToKey(last(way)), way);
			return;
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

		toRings(direction) {
			let strings = this.toStrings();
			let rings = [], string = null;
			while (string = strings.shift()) {
				if (isRing(string)) {
					if (ringDirection(string) != direction) string.reverse();
					rings.push(string);
				}	
			}
			return rings;
		}
	}

	return {first, last, coordsToKey, addToMap, removeFromMap, getFirstFromMap, 
		isRing, ringDirection, ptInsidePolygon, strToFloat, 
		RefElements, LateBinder, WayCollection};
})();