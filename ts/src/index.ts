import {FeatureCollection, GeometryObject} from 'geojson';
import {Node, Way, Relation} from './osmobjs';
import {purgeProps, RefElements} from './utils';
import XmlParser from './xmlparser';

interface Options {
	completeFeature?: boolean;
	allFeatures?: boolean;
	renderTagged?: boolean;
	excludeWay?: boolean;
	suppressWay?: boolean;
}

export default (osm: string | {[k: string]: any}, opts?: Options): FeatureCollection<GeometryObject> => {
	let completeFeature = false, renderTagged = false, excludeWay = true;

	const parseOpts = (opts: Options) => {
		if (opts) {
			completeFeature = opts.completeFeature || opts.allFeatures? true : false;
			renderTagged = opts.renderTagged? true : false;
			let wayOpt = opts.suppressWay || opts.excludeWay;
			if (wayOpt !== undefined && !wayOpt) excludeWay = false;
		}
	}

	if (opts) parseOpts(opts);

	const detectFormat = (osm: string | {[k: string]: any}): string => {
		if ((<{[k: string]: any}>osm).elements) return 'json';
		if (osm.indexOf('<osm') >= 0) return 'xml';
		if (osm.trim().startsWith('{')) return 'json-raw';
		return 'invalid';
	}

	let format = detectFormat(osm);

	let refElements = new RefElements(), featureArray: any[] = [];

	const analyzeFeaturesFromJson = (osm: string | {[k: string]: any}) => {
		for (let elem of (<{[k: string]: any}>osm).elements) {
			switch(elem.type) {
				case 'node':
					let node = new Node(elem.id, refElements);
					if (elem.tags) node.addTags(elem.tags);
					node.addProps(purgeProps(<{[k: string]: string}>elem, ['id', 'type', 'tags', 'lat', 'lon']));
					node.setLatLng(elem);
					break;

				case 'way':
					let way = new Way(elem.id, refElements);
					if (elem.tags) way.addTags(elem.tags);
					way.addProps(purgeProps(<{[k: string]: string}>elem, ['id', 'type', 'tags', 'nodes', 'geometry']));
					if (elem.nodes)
						for (let n of elem.nodes)
							way.addNodeRef(n);
					else if (elem.geometry)
						way.setLatLngArray(elem.geometry);
					break;

				case 'relation':
					let relation = new Relation(elem.id, refElements);
					if (elem.bounds)
						relation.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
					if (elem.tags) relation.addTags(elem.tags);
					relation.addProps(purgeProps(<{[k: string]: string}>elem, ['id', 'type', 'tags', 'bounds', 'members']));
					if (elem.members)
						for (let member of elem.members)
							relation.addMember(member);
					break;

				default:
					break;
			}
		}
	}

	const analyzeFeaturesFromXml = (osm: string | {[k: string]: any}) => {
		const xmlParser = new XmlParser({progressive: true});

		xmlParser.on('</osm.node>', (node: {[k: string]: any}) => {
			let nd = new Node(node.id, refElements);
			for (let [k, v] of Object.entries(node))
				if (!k.startsWith('$') && ['id', 'lon', 'lat'].indexOf(k) < 0)
					nd.addProp(k, v);
			nd.setLatLng(node);
			if (node.$innerNodes)
				for (let ind of node.$innerNodes)
					if(ind.$tag === 'tag')
						nd.addTag(ind.k, ind.v);
		});

		xmlParser.on('</osm.way>', (node: {[k: string]: any}) => {
			let way = new Way(node.id, refElements);
			for (let [k, v] of Object.entries(node))
				if (!k.startsWith('$') && ['id'].indexOf(k) < 0)
					way.addProp(k, v);
			if (node.$innerNodes) {
				for (let ind of node.$innerNodes)
					if (ind.$tag === 'nd') {
						if (ind.lon && ind.lat)
							way.addLatLng(ind);
						else if (ind.ref)
							way.addNodeRef(ind.ref);
					} else if (ind.$tag === 'tag')
						way.addTag(ind.k, ind.v);
			}
		});

		xmlParser.on('<osm.relation>', (node: {[k: string]: any}) => {
			new Relation(node.id, refElements);
		});

		xmlParser.on('</osm.relation.member>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
			let relation = refElements.get(`relation/${parent.id}`);
			let member: {[k: string]: any} = {
				type: node.type,
				role: node.role? node.role : '',
				ref: node.ref
			};

			if (node.lat && node.lon) {
				member.lat = node.lat, member.lon = node.lon, member.tags = {};
				for (let [k, v] of Object.entries(node))
					if (!k.startsWith('$') && ['type', 'lat', 'lon'].indexOf(k) < 0)
						member[k] = v;
			}

			if (node.$innerNodes) {
				let geometry: any[] = [];
				let nodes: any[] = [];
				for (let ind of node.$innerNodes) {
					if (ind.lat && ind.lon)
						geometry.push(ind);
					else if (ind.ref)
						nodes.push(ind.ref);
				}
				if (geometry.length > 0)
					member.geometry = geometry;
				else if (nodes.length > 0)
					member.nodes = nodes;
			}
			relation.addMember(member);
		});

		xmlParser.on('</osm.relation.bounds>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
			refElements.get(`relation/${parent.id}`).setBounds([parseFloat(node.minlon), parseFloat(node.minlat), parseFloat(node.maxlon), parseFloat(node.maxlat)]);
		});

		xmlParser.on('</osm.relation.tag>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
			refElements.get(`relation/${parent.id}`).addTag(node.k, node.v);
		});
		
		xmlParser.parse(<string>osm);
	}

	if (format === 'json-raw') {
		osm = <{[k: string]: any}>JSON.parse(<string>osm);
		if ((<{[k: string]: any}>osm.elements)) format = 'json';
		else format = 'invalid';
	}

	if (format === 'json')
		analyzeFeaturesFromJson(osm);
	else if (format === 'xml')
		analyzeFeaturesFromXml(osm);

	refElements.bindAll();

	for (let v of refElements.values()) {
		if (v.refCount <= 0 || (v.hasTag && renderTagged && !(v instanceof Way && excludeWay))) {
			let features = v.toFeatureArray();
			// return the first geometry of the first relation element
			if (v instanceof Relation && !completeFeature && features.length > 0)
				return features[0].geometry;

			featureArray = featureArray.concat(features);
		}
	}

	return {type: 'FeatureCollection', features: featureArray};
}
