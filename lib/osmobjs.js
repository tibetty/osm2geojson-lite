module.exports = (() => {
	'use strict';
	const {first, last, coordsToKey, addToMap, removeFromMap, getFirstFromMap, 
		isRing, ringDirection, ptInsidePolygon, strToFloat, 
		LateBinder, WayCollection} = require('./utils.js');

	class OsmObject {
		constructor(type, id, refElems) {
			this.type = type;
			this.id = id;
			this.refElems = refElems;
			this.tags = {};
			this.properties = {id: this.getCompositeId()};
			this.refCount = 0;
			if (refElems) refElems.add(id, this);
		}

		addTags(tags) {
			this.tags = Object.assign(this.tags, tags);
		}

		addTag(k, v) {
			this.tags[k] = v;
		}

		addProperty(k, v) {
			this.properties[k] = v;
		}

		getCompositeId() {
			return `${this.type}/${this.id}`;
		}

		getProperties() {
			return Object.assign(this.properties, this.tags);
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
					properties: this.getProperties(),
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

		bindRefs() {
			// for (let nd of this.coordsArray)
				// if (nd instanceof LateBinder) nd.bind();
			this.coordsArray.reduce((a, v) => v instanceof LateBinder? a.concat([v]) : a, []).forEach(lb => lb.bind());
		}

		toCoordsArray() {
			this.bindRefs();
			return this.coordsArray;
		}

		toFeature() {
			this.bindRefs();
			if (this.coordsArray.length > 1) {
				if (isRing(this.coordsArray)) {
					if (ringDirection(this.coordsArray) !== 'counterclockwise') this.coordsArray.reverse();
					return {
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProperties(),
						geometry: {
							type: 'Polygon',
							coordinates: [strToFloat(this.coordsArray)]
						}
					}
				}

				return {
					type: 'Feature',
					id: this.getCompositeId(),
					properties: this.getProperties(),
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
						let way = new Way(member.id, this.refElems);
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
						let entries = Object.entries(member);
						for (let [k, v] of entries) {
							if (k !== 'lat' && k !== 'lon' && k !== 'id' && k !== 'tags')
								node.addTag(k, v);
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
			const fieldsToBind = ['relations', 'nodes', 'outer', 'inner', ''];
			for (let fieldName of fieldsToBind) {
				let field = this[fieldName];
				if (field && field.length > 0) {
					let clone = field.slice(0);
					for (let item of clone) {
						if (item instanceof LateBinder) item.bind();
						else if (item.bindRefs) item.bindRefs();
					}
				}
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
			const waysToProcess = ['outer', 'inner', ''];
			for (let relation of this.relations) {
				console.log(relation.constructor.name);
				console.log(relation.id);
				if (relation && relation.bindRefs()) {
					for (let waysName of waysToProcess) {
						let ways = relation[waysName];
						if (ways) {
							let thisWays = this[waysName];
							if (thisWays) [].splice.apply(thisWays, [thisWays.length, 0].concat(ways));
							else this[waysName] = ways;
						}
					}
				}
			}

			for (let waysName of waysToProcess) {
				let ways = this[waysName];
				if (ways) {
					this[waysName] = new WayCollection();
					for (let way of ways) {
						this[waysName].addWay(way);
					}
				}
			}

			let geometry = null;
			if (this.outer) {
				geometry = constructPolygonGeometry(this.outer, this.inner);
				if (geometry)
					polygonFeatures.push({
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProperties(),
						geometry
					});
			}
			else if (this['']) {
				geometry = constructStringGeometry(this['']);
				if (geometry)
					stringFeatures.push({
						type: 'Feature',
						id: this.getCompositeId(),
						properties: this.getProperties(),
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