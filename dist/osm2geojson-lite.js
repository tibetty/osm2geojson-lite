(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const {Node, Way, Relation} = require('./osmobjs.js'),
	{purgeProps, RefElements} = require('./utils.js'),
	XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {
	let completeFeature = false, renderTagged = false, suppressWay = true;

	let parseOpts = opts => {
		if (opts) {
			completeFeature = opts.completeFeature || opts.allFeatures? true : false;
			renderTagged = opts.renderTagged? true : false;
			if (opts.suppressWay !== undefined && !opts.suppressWay) suppressWay = false;
		}
	}

	parseOpts(opts);

	let refElements = new RefElements(), featureArray = [];

	let analyzefeaturesFromJson = () => {
		for (let elem of osm.elements) {
			switch(elem.type) {
				case 'node':
					let node = new Node(elem.id, refElements);
					if (elem.tags)
						node.addTags(elem.tags);
					node.addProps(purgeProps(elem, ['id', 'type', 'tags', 'lat', 'lon']));
					node.setCoords([elem.lon, elem.lat]);
					break;

				case 'way':
					let way = new Way(elem.id, refElements);
					if (elem.tags) way.addTags(elem.tags);
					way.addProps(purgeProps(elem, ['id', 'type', 'tags', 'nodes', 'geometry']));
					if (elem.nodes)
						for (let n of elem.nodes)
							way.addNodeRef(n);
					else if (elem.geometry)
						for (let g of elem.geometry)
							way.addCoords([g.lon, g.lat]);
					break;

				case 'relation':
					let relation = new Relation(elem.id, refElements);
					if (elem.bounds) with (elem.bounds)
						relation.addProp('bbox', [parseFloat(minlon), parseFloat(minlat), parseFloat(maxlon), parseFloat(maxlat)]);
					if (elem.tags) relation.addTags(elem.tags);
					relation.addProps(purgeProps(elem, ['id', 'type', 'tags', 'bounds', 'members']));
					if (elem.members)
						for (let member of elem.members)
							relation.addMember(member);
					break;
				default:
					break;
			}
		}
	}

	let analyzefeaturesFromXml = () => {
		const xmlParser = new XmlParser({progressive: true});

		xmlParser.on('<osm.node>', node => {
			new Node(node.$id, refElements);
		});

		xmlParser.on('<osm.way>', node => {
			new Way(node.$id, refElements);
		});

		xmlParser.on('<osm.relation>', node => {
			new Relation(node.$id, refElements);
		});

		xmlParser.on('</osm.way>', node => {
			with (node) {
				let way = refElements[$id];
				for (let [k, v] of Object.entries(node))
					if (k.startsWith('$') && ['$id'].indexOf(k) < 0)
						way.addProp(k.substring(1), v);
				if (node.innerNodes) {
					for (let ind of innerNodes)
						if (ind.$lon && ind.$lat)
							way.addCoords([ind.$lon, ind.$lat]);
						else if (ind.$ref)
							way.addNodeRef(ind.$ref);
						else if(ind.tag === 'tag')
							way.addTag(ind.$k, ind.$v);
				}
			}
		});

		xmlParser.on('</osm.node>', node => {
			with (node) {
				let nd = refElements[$id];
				for (let [k, v] of Object.entries(node))
					if (k.startsWith('$') && ['$id', '$lon', '$lat'].indexOf(k) < 0)
						nd.addProp(k.substring(1), v);
				nd.setCoords([$lon, $lat]);
				if (node.innerNodes)
					for (let ind of innerNodes)
						if(ind.tag === 'tag')
							nd.addTag(ind.$k, ind.$v);
			}
		});

		xmlParser.on('</osm.relation.member>', (node, parent) => {
			with (node) {
				let relation = refElements[parent.$id];
				let member = {
					type: $type,
					role: node.$role? $role : '',
					ref: $ref
				};

				if (node.$lat && node.$lon) {
					member.lat = $lat, member.lon = $lon, member.tags = {};
					for (let [k, v] of Object.entries(node))
						if (k.startsWith('$') && ['$type', '$lat', '$lon'].indexOf(k) < 0)
							member[k.substring(1)] = v;
				}

				if (node.innerNodes) {
					let geometry = [];
					let nodes = [];
					for (let ind of innerNodes) {
						if (ind.$lat && ind.$lon)
							geometry.push({lat: ind.$lat, lon: ind.$lon});
						else
							nodes.push(ind.$ref);
					}
					if (geometry.length > 0)
						member.geometry = geometry;
					else if (nodes.length > 0)
						member.nodes = nodes;
				}
				relation.addMember(member);
			}
		});

		xmlParser.on('</osm.relation.bounds>', (node, parent) => {
			with (node)
				refElements[parent.$id].addProp('bbox', [parseFloat($minlon), parseFloat($minlat), parseFloat($maxlon), parseFloat($maxlat)]);
		});

		xmlParser.on('</osm.relation.tag>', (node, parent) => {
			let elem = refElements[parent.$id];
			if (elem) elem.addTag(node.$k, node.$v);
		});
		
		xmlParser.parse(osm);
	}

	if (osm.elements)
		analyzefeaturesFromJson(osm);
	else
		analyzefeaturesFromXml(osm);

	for (let [k, v] of Object.entries(refElements)) {
		if (v && (v.refCount <= 0 || (renderTagged && v.hasTag && !(v instanceof Way && suppressWay)))) {
			if (v.toFeature) {
				let feature = v.toFeature();
				if (feature) featureArray.push(feature);
			} else if (v.toFeatureArray)
				featureArray = featureArray.concat(v.toFeatureArray());
		}
	}

	refElements.cleanup();

	if (!completeFeature && featureArray.length > 0)
		return featureArray[0].geometry;

	return {type: 'FeatureCollection', features: featureArray};
}
},{"./osmobjs.js":2,"./utils.js":4,"./xmlparser.js":5}],2:[function(require,module,exports){
module.exports = (() => {
	'use strict';

	const {first, last, coordsToKey,
		addToMap, removeFromMap, getFirstFromMap, 
		isRing, ringDirection, ptInsidePolygon, strToFloat, 
		LateBinder, WayCollection} = require('./utils.js'),
		polygonTags = require('./polytags.json');

	class OsmObject {
		constructor(type, id, refElems) {
			this.type = type;
			this.id = id;
			this.refElems = refElems;
			this.tags = {};
			this.props = {id: this.getCompositeId()};
			this.refCount = 0;
			this.hasTag = false;
			if (refElems) refElems.add(id, this);
		}

		addTags(tags) {
			this.tags = Object.assign(this.tags, tags);
			this.hasTag = tags? true : false;
		}

		addTag(k, v) {
			this.tags[k] = v;
			this.hasTag = k? true : false;
		}

		addProp(k, v) {
			this.props[k] = v;
		}

		addProps(props) {
			this.props = Object.assign(this.props, props);	
		}

		getCompositeId() {
			return `${this.type}/${this.id}`;
		}

		getProps() {
			return Object.assign(this.props, this.tags);
		}		

		// to remove circular reference that prevent gc from working
		unlinkRef() {
			this.refElems = null;
		}
	}

	class Node extends OsmObject {
		constructor(id, refElems) {
			super('node', id, refElems);
			this.coords = null;
		}

		setCoords(coords) {
			if (coords instanceof Array) {
				this.coords = coords;
			}
		}

		toFeature() {
			if (this.coords) {
				return {
					type: 'Feature',
					id: this.getCompositeId(),
					properties: this.getProps(),
					geometry: {
						type: 'Point',
						coordinates: strToFloat(this.coords)
					}
				};
			}
		}

		getCoords() {
			return this.coords;
		}
	}

	class Way extends OsmObject {
		constructor(id, refElems) {
			super('way', id, refElems);
			this.coordsArray = [];
			this.isPolygon = false;
			this.isBound = false;
		}

		addCoords(coords) {
			this.coordsArray.push(coords);
		}

		addNodeRef(ref) {
			this.coordsArray.push(new LateBinder(this.coordsArray, function(id) {
				let node = this.refElems[id];
				if (node) {
					node.refCount++;
					return node.getCoords();
				}
			}, this, [ref]));
		}

		analyzeTag(k, v) {
			let o = polygonTags[k];
			if (o) {
				this.isPolygon = true;
				if (o.whitelist) this.isPolygon = o.whitelist.indexOf(v) >= 0? true : false;
				else if(o.blacklist) this.isPolygon = o.blacklist.indexOf(v) >= 0? false : true;
				// console.log(`${k}: ${v} => way/${this.id} is a polygon: ${this.isPolygon}`);
			}
		}

		addTags(tags) {
			super.addTags(tags);
			for (let [k, v] of Object.entries(tags))
				this.analyzeTag(k, v);
		}

		addTag(k, v) {
			super.addTag(k, v);
			this.analyzeTag(k, v);
		}

		bindRefs() {
			if (!this.isBound) {
				this.coordsArray.reduce((a, v) => v instanceof LateBinder? a.concat([v]) : a, []).forEach(lb => lb.bind());
				this.isBound = true;
			}
		}

		toCoordsArray() {
			this.bindRefs();
			return this.coordsArray;
		}

		toFeature() {
			this.bindRefs();
			if (this.coordsArray.length > 1) {
				if (this.isPolygon && isRing(this.coordsArray)) {
					if (ringDirection(this.coordsArray) !== 'counterclockwise') this.coordsArray.reverse();
					return {
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProps(),
						geometry: {
							type: 'Polygon',
							coordinates: [strToFloat(this.coordsArray)]
						}
					}
				}

				return {
					type: 'Feature',
					id: this.getCompositeId(),
					properties: this.getProps(),
					geometry: {
						type: 'LineString',
						coordinates: strToFloat(this.coordsArray)
					}
				}
			}
		}
	}

	class Relation extends OsmObject {
		constructor(id, refElems) {
			super('relation', id, refElems);
			this.relations = [];
			this.nodes = [];
			this.isBound = false;
		}

		addMember(member) {
			switch (member.type) {
				// super relation, need to do combination
				case 'relation':
					this.relations.push(new LateBinder(this.relations, function(id) {
						let relation = this.refElems[id];
						if (relation) {
							relation.refCount++;
							return relation;
						}
					}, this, [member.ref]));
					break;
				case 'way':
					if (!member.role) member.role === '';
					let ways = this[member.role];
					if (!ways) ways = this[member.role] = [];
					if (member.geometry) {
						let way = new Way(member.ref, this.refElems);
						for (let nd of member.geometry) {
							way.addCoords([nd.lon, nd.lat]);
							way.refCount++;
						}
						ways.push(way);
					} else if (member.nodes) {
						let way = new Way(member.ref, this.refElems);
						for (let nid of nodes) {
							way.addNodeRef(nid);
							way.refCount++;
						}
						ways.push(way);
					} else ways.push(new LateBinder(ways, function(id) {
						let way = this.refElems[id];
						if (way) {
							way.refCount++;
							return way;
						}
					}, this, [member.ref]));
					break;
				case 'node':
					let node = null;
					if (member.lat && member.lon) {
						node = new Node(member.ref, this.refElems);
						node.setCoords([member.lon, member.lat]);
						if (member.tags) node.addTags(member.tags);
						for (let [k, v] of Object.entries(member)) {
							if (k !== 'id' && k !== 'type' && k !== 'lat' && k !== 'lon')
								node.addProp(k, v);
						}
						node.refCount++;
						this.nodes.push(node);
					} else {
						this.nodes.push(new LateBinder(this.nodes, function(id) {
							let node = this.refElems[id];
							if (node) {
								node.refCount++;
								return node;
							}
						}, this, [member.ref]));
					}
					break;
				default: 
					break;
			}
		}

		bindRefs() {
			if (!this.isBound) {
				const fieldsToBind = ['relations', 'nodes', 'outer', 'inner', ''];
				for (let fieldName of fieldsToBind) {
					let field = this[fieldName];
					if (field && field.length > 0) {
						// need a clone 'coz bind will remove elements
						let clone = field.slice(0);
						for (let item of clone) {
							if (item instanceof LateBinder) item.bind();
							else if (item.bindRefs) item.bindRefs();
						}
					}
				}
				this.isBound = true;
			}
		}

		toFeatureArray() {
			let constructStringGeometry = (ws) => {
				let strings = ws? ws.toStrings() : [];
				if (strings.length > 0) {
					if (strings.length === 1) return {
						type: 'LineString',
						coordinates: strings[0]
					}

					return {
						type: 'MultiLineString',
						coordinates: strings
					}
				}
				return null;
			}

			let constructPolygonGeometry = (ows, iws) => {
				let outerRings = ows? ows.toRings('counterclockwise') : [],
					innerRings = iws? iws.toRings('clockwise') : [];
								
				if (outerRings.length > 0) {
					let compositPolyons = [];

					let ring = null;
					for (ring of outerRings)
						compositPolyons.push([ring]);
					
					// link inner polygons to outer containers
					while (ring = innerRings.shift()) {
						for (let idx in outerRings) {
							if (ptInsidePolygon(first(ring), outerRings[idx])) {
								compositPolyons[idx].push(ring);
								break;
							}
						}
					}

					// construct the Polygon/MultiPolygon geometry
					if (compositPolyons.length === 1) return {
						type: 'Polygon',
						coordinates: compositPolyons[0]
					};

					return {
						type: 'MultiPolygon',
						coordinates: compositPolyons
					}
				}

				return null;
			}

			this.bindRefs();
			
			let polygonFeatures = [], stringFeatures = [], pointFeatures = [];
			const waysFieldNames = ['outer', 'inner', ''];
			for (let relation of this.relations) {
				if (relation) {
					relation.bindRefs();
					for (let fieldName of waysFieldNames) {
						let ways = relation[fieldName];
						if (ways) {
							let thisWays = this[field];
							if (thisWays) [].splice.apply(thisWays, [thisWays.length, 0].concat(ways));
							else this[fieldName] = ways;
						}
					}
				}
			}

			for (let fieldName of waysFieldNames) {
				let ways = this[fieldName];
				if (ways) {
					this[fieldName] = new WayCollection();
					for (let way of ways)
						this[fieldName].addWay(way);
				}
			}

			let geometry = null;
			if (this.outer) {
				geometry = constructPolygonGeometry(this.outer, this.inner);
				if (geometry)
					polygonFeatures.push({
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProps(),
						geometry
					});
			}
			else if (this['']) {
				geometry = constructStringGeometry(this['']);
				if (geometry)
					stringFeatures.push({
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProps(),
						geometry
					});
			}

			for (let node of this.nodes)
				pointFeatures.push(node.toFeature());

			return polygonFeatures.concat(stringFeatures).concat(pointFeatures);
		}
	}

	return {Node, Way, Relation}; 
})();
},{"./polytags.json":3,"./utils.js":4}],3:[function(require,module,exports){
module.exports={"building":{},"highway":{"whitelist":["services","rest_area","escape","elevator"]},"natural":{"blacklist":["coastline","cliff","ridge","arete","tree_row"]},"landuse":{},"waterway":{"whitelist":["riverbank","dock","boatyard","dam"]},"amenity":{},"leisure":{},"barrier":{"whitelist":["city_wall","ditch","hedge","retaining_wall","wall","spikes"]},"railway":{"whitelist":["station","turntable","roundhouse","platform"]},"area":{},"boundary":{},"man_made":{"blacklist":["cutline","embankment","pipeline"]},"power":{"whitelist":["plant","substation","generator","transformer"]},"place":{},"shop":{},"aeroway":{"blacklist":["taxiway"]},"tourism":{},"historic":{},"public_transport":{},"office":{},"building:part":{},"military":{},"ruins":{},"area:highway":{},"craft":{},"golf":{},"indoor":{}}
},{}],4:[function(require,module,exports){
module.exports = (() => {
	'use strict';

	let purgeProps = (obj, blacklist) => {
		if (obj) {
			let rs = Object.assign({}, obj);
			for (let prop of blacklist) delete rs[prop];
			return rs;
		}
		return {};
	}

	let mergeProps = (obj1, obj2) => {
		obj1 = obj1? obj1 : {};
		obj2 = obj2? obj2 : {};
		return Object.assign(obj1, obj2);
	}

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

	let isRing = a => a.length > 2 && coordsToKey(first(a)) === coordsToKey(last(a));

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
			for (let [k, v] of Object.entries(this)) {
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
			} else if (typeof this.container === 'object') {
				let k = Object.keys(this.container).find(v => this.container[v] === this);
				if (k)
					if (v) this.container[k] = v;
					else delete this.container[k];
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

	return {purgeProps, mergeProps,
		first, last, coordsToKey,
		addToMap, removeFromMap, getFirstFromMap,
		isRing, ringDirection, ptInsidePolygon, strToFloat,
		RefElements, LateBinder, WayCollection};
})();
},{}],5:[function(require,module,exports){
module.exports = (() => {
	'use strict';
	
	function conditioned(evt) {
		return evt.match(/^(.+?)\[(.+?)\]>$/g) != null;
	}

	function parseEvent(evt) {
		let match = /^(.+?)\[(.+?)\]>$/g.exec(evt);
		if (match)
			return {evt: match[1] + '>', exp: match[2]};
		return {evt: evt};
	}

	function genConditionFunc(cond) {
		let body = 'return ' + cond.replace(/(\$.+?)(?=[=!.])/g, 'node.$&') + ';';
		return new Function('node', body);
	}

	return class {
		constructor(opts) {
			if (opts) {
				this.queryParent = opts.queryParent? true : false;
				this.progressive = opts.progressive;
				if (this.queryParent) this.parentMap = new WeakMap();
			}
			this.evtListeners = {};
		}

		parse(xml, parent, dir) {
			dir = dir? dir + '.' : '';
			let nodeRegEx = /<([^ >\/]+)(.*?)>/mg, nodeMatch = null, nodes = [];
			while (nodeMatch = nodeRegEx.exec(xml)) {
				let tag = nodeMatch[1], node = {tag}, fullTag = dir + tag; 

				let attrText = nodeMatch[2].trim(), closed = false;
				if (attrText.endsWith('/') || tag.startsWith('?') || tag.startsWith('!')) {
					closed = true;
				}

				let attRegEx1 = /([^ ]+?)="(.+?)"/g, attRegEx2 = /([^ ]+?)='(.+?)'/g;
				let attMatch = null, hasAttrs = false;
				while (attMatch = attRegEx1.exec(attrText)) {
					hasAttrs = true;
					node[`$${attMatch[1]}`] = attMatch[2];
				}
				if (!hasAttrs)
					while (attMatch = attRegEx2.exec(attrText)) {
						hasAttrs = true;
						node[`$${attMatch[1]}`] = attMatch[2];
					}

				if (!hasAttrs && attrText !== '') node.text = attrText;
				if (this.progressive) this.emit(`<${fullTag}>`, node, parent);


				if (!closed) {
					let innerRegEx = new RegExp(`([^]+?)<\/${tag}>`, 'g');
					innerRegEx.lastIndex = nodeRegEx.lastIndex;
					let innerMatch = innerRegEx.exec(xml);
					if (innerMatch && innerMatch[1]) {
						nodeRegEx.lastIndex = innerRegEx.lastIndex;
						let innerNodes = this.parse(innerMatch[1], node, fullTag);
						if (innerNodes.length > 0) node.innerNodes = innerNodes;
						else node.innerText = innerMatch[1];
					}
				}
				if (this.queryParent && parent) {
					this.parentMap.set(node, parent);
				}

				if (this.progressive) this.emit(`</${fullTag}>`, node, parent);

				nodes.push(node);
			}

			return nodes;
		}

		getParent(node) {
			if (this.queryParent)
				return this.parentMap.get(node);
			return null;
		}

		$addListener(evt, func) {
			let funcs = this.evtListeners[evt];
			if (funcs) funcs.push(func);
			else this.evtListeners[evt] = [func];
		}

		// support javascript condition for the last tag
		addListener(evt, func) {
			if (conditioned(evt)) {
				// func.prototype = evt;
				evt = parseEvent(evt);	
				func.condition = genConditionFunc(evt.exp);
				evt = evt.evt;
			}
			this.$addListener(evt, func);
		}

		$removeListener(evt, func) {
			let funcs = this.evtListeners[evt];
			if (funcs) {
				funcs.splice(funcs.indexOf(func), 1);
			}
		}

		removeListener(evt, func) {
			if (conditioned(evt)) {
				evt = parseEvent(evt);	
				evt = evt.evt;
			}
			this.$removeListener(evt, func);
		}

		emit(evt, ...args) {
			let funcs = this.evtListeners[evt];
			if (funcs) {
				for (let func of funcs) {
					if (func.condition) {
						if (func.condition.apply(null, args) === true)
							func.apply(null, args);
					} else 
						func.apply(null, args);
				}
			}
		}

		on(evt, func) {
			this.addListener(evt, func);
		}

		off(evt, func) {
			this.removeListener(evt, func);
		}
	};
})();
},{}]},{},[1]);
