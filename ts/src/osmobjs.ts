import {first, last, coordsToKey,
	addToMap, removeFromMap, getFirstFromMap, 
	isRing, ringDirection, ptInsidePolygon, strToFloat, 
	LateBinder, WayCollection, RefElements} from './utils';

import polygonTags from './polytags.json';

class OsmObject {
	type: string;
	id: string;
	refElems: RefElements;
	tags: {[k: string]: string};
	props: {[k: string]: string};
	refCount: number;
	hasTag: boolean;

	constructor(type: string, id: string, refElems: RefElements) {
		this.type = type;
		this.id = id;
		this.refElems = refElems;
		this.tags = {};
		this.props = {id: this.getCompositeId()};
		this.refCount = 0;
		this.hasTag = false;
		if (refElems) refElems.add(this.getCompositeId(), this);
	}

	addTags(tags: {[k: string]: string}) {
		this.tags = Object.assign(this.tags, tags);
		this.hasTag = tags? true : false;
	}

	addTag(k: string, v: string) {
		this.tags[k] = v;
		this.hasTag = k? true : false;
	}

	addProp(k: string, v: any) {
		this.props[k] = v;
	}

	addProps(props: {[k: string]: string}) {
		this.props = Object.assign(this.props, props);	
	}

	getCompositeId(): string {
		return `${this.type}/${this.id}`;
	}

	getProps(): Object {
		return Object.assign(this.props, this.tags);
	}		

	toFeatureArray(): any[] {
		return [];
	}
}

export class Node extends OsmObject {
	latLng: any;

	constructor(id: string, refElems: RefElements) {
		super('node', id, refElems);
		this.latLng = null;
	}

	setLatLng(latLng: any) {
		this.latLng = latLng;
	}

	toFeatureArray(): any[] {
		if (this.latLng)
			return [{
				type: 'Feature',
				id: this.getCompositeId(),
				properties: this.getProps(),
				geometry: {
					type: 'Point',
					coordinates: strToFloat([this.latLng.lon, this.latLng.lat])
				}
			}];

		return [];
	}

	getLatLng(): any {
		return this.latLng;
	}
}

export class Way extends OsmObject {
	latLngArray: any[];
	isPolygon: boolean;

	constructor(id: string, refElems: RefElements) {
		super('way', id, refElems);
		this.latLngArray = [];
		this.isPolygon = false;
	}

	addLatLng(latLng: any) {
		this.latLngArray.push(latLng);
	}

	setLatLngArray(latLngArray: any[]) {
		this.latLngArray = latLngArray;
	}

	addNodeRef(ref: string) {
		let binder = new LateBinder(this.latLngArray, function(id: string) {
			let node = this.refElems.get(`node/${id}`);
			if (node) {
				node.refCount++;
				return node.getLatLng();
			}
		}, this, [ref]);

		this.latLngArray.push(binder);
		this.refElems.addBinder(binder);
	}

	analyzeTag(k: string, v: string) {
		let o = (<any>polygonTags)[k];
		if (o) {
			this.isPolygon = true;
			if (o.whitelist) this.isPolygon = o.whitelist.indexOf(v) >= 0? true : false;
			else if(o.blacklist) this.isPolygon = o.blacklist.indexOf(v) >= 0? false : true;
		}
	}

	addTags(tags: {[k: string]: string}) {
		super.addTags(tags);
		for (let [k, v] of Object.entries(tags))
			this.analyzeTag(k, v);
	}

	addTag(k: string, v: string) {
		super.addTag(k, v);
		this.analyzeTag(k, v);
	}

	toCoordsArray(): any[] {
		return this.latLngArray.map(latLng => [latLng.lon, latLng.lat]);
	}

	toFeatureArray(): any[] {
		let coordsArray = this.toCoordsArray();
		if (coordsArray.length > 1) {
			coordsArray = strToFloat(coordsArray);
			let feature = {
				type: 'Feature',
				id: this.getCompositeId(),
				properties: this.getProps(),
				geometry: {
					type: 'LineString',
					coordinates: coordsArray
				}
			};

			if (this.isPolygon && isRing(coordsArray)) {
				if (ringDirection(coordsArray) !== 'counterclockwise') coordsArray.reverse();

				feature.geometry = {
					type: 'Polygon',
					coordinates: [coordsArray]
				};

				return [feature];
			}

			return [feature];
		}

		return [];
	}
}

export class Relation extends OsmObject {
	relations: any[];
	nodes: any[];
	bounds: any[];
	[k: string]: any;

	constructor(id: string, refElems: RefElements) {
		super('relation', id, refElems);
		this.relations = [];
		this.nodes = [];
		this.bounds = <any>null;
	}

	setBounds(bounds: any[]) {
		this.bounds = bounds;
	}

	addMember(member: {[k: string]: any}) {
		switch (member.type) {
			// super relation, need to do combination
			case 'relation':
				let binder = new LateBinder(this.relations, function(id) {
					let relation = this.refElems.get(`relation/${id}`);
					if (relation) {
						relation.refCount++;
						return relation;
					}
				}, this, [member.ref]);
				this.relations.push(binder);
				this.refElems.addBinder(binder);
				break;

			case 'way':
				if (!member.role) member.role === '';
				let ways = this[member.role];
				if (!ways) ways = this[member.role] = [];
				if (member.geometry) {
					let way = new Way(member.ref, this.refElems);
					way.setLatLngArray(member.geometry);
					way.refCount++;
					ways.push(way);
				} else if (member.nodes) {
					let way = new Way(member.ref, this.refElems);
					for (let nid of member.nodes) {
						way.addNodeRef(nid);
					}
					way.refCount++;
					ways.push(way);
				} else {
					let binder = new LateBinder(ways, function(id) {
						let way = this.refElems.get(`way/${id}`);
						if (way) {
							way.refCount++;
							return way;
						}
					}, this, [member.ref]);
					ways.push(binder);
					this.refElems.addBinder(binder);
				}
				break;

			case 'node':
				let node = <any>null;
				if (member.lat && member.lon) {
					node = new Node(member.ref, this.refElems);
					node.setLatLng({lon: member.lon, lat: member.lat});
					if (member.tags) node.addTags(member.tags);
					for (let [k, v] of Object.entries(member))
						if (['id', 'type', 'lat', 'lon'].indexOf(k) < 0)
							node.addProp(k, v);

					node.refCount++;
					this.nodes.push(node);
				} else {
					let binder = new LateBinder(this.nodes, function(id) {
						let node = this.refElems.get(`node/${id}`);
						if (node) {
							node.refCount++;
							return node;
						}
					}, this, [member.ref]);
					this.nodes.push(binder);
					this.refElems.addBinder(binder);
				}
				break;
				
			default: 
				break;
		}
	}

	toFeatureArray() {
		const constructStringGeometry = (ws: WayCollection) => {
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
			return null;			}

		const constructPolygonGeometry = (ows: WayCollection, iws: WayCollection) => {
			let outerRings = ows? ows.toRings('counterclockwise') : [],
				innerRings = iws? iws.toRings('clockwise') : [];
							
			if (outerRings.length > 0) {
				let compositPolyons: any[] = [];

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

		let polygonFeatures: any[] = [], stringFeatures: any[] = [], pointFeatures: any[] = [];
		const waysFieldNames = ['outer', 'inner', ''];
		// need to do combination when there're nested relations
		for (let relation of this.relations) {
			if (relation) {
				for (let fieldName of waysFieldNames) {
					let ways = relation[fieldName];
					if (ways) {
						let thisWays = this[fieldName];
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

		let geometry: any = null;
		
		let feature: {[k: string]: any} = {
			type: 'Feature',
			id: this.getCompositeId(),
			bbox: this.bounds,
			properties: this.getProps()
		};

		if (!this.bounds)
			delete feature.bbox;

		if (this.outer) {
			geometry = constructPolygonGeometry(this.outer, this.inner);
			if (geometry){
				feature.geometry = geometry;
				polygonFeatures.push(feature);
			}
		}
		else if (this['']) {
			geometry = constructStringGeometry(this['']);
			if (geometry) {
				feature.geometry = geometry;
				stringFeatures.push(feature);
			}
		}

		for (let node of this.nodes)
			pointFeatures = pointFeatures.concat(node.toFeatureArray());

		return polygonFeatures.concat(stringFeatures).concat(pointFeatures);
	}
}