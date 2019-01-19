const {Node, Way, Relation} = require('./osmobjs.js'),
	{purgeProps, RefElements} = require('./utils.js'),
	XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {
	let completeFeature = false, renderTagged = false, excludeWay = true;

	let parseOpts = opts => {
		if (opts) {
			completeFeature = opts.completeFeature || opts.allFeatures? true : false;
			renderTagged = opts.renderTagged? true : false;
			let wayOpt = opts.suppressWay || opts.excludeWay;
			if (wayOpt !== undefined && !wayOpt) excludeWay = false;
		}
	}

	parseOpts(opts);

	let refElements = new RefElements(), featureArray = [];

	let analyzefeaturesFromJson = osm => {
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
						relation.setBbox([parseFloat(minlon), parseFloat(minlat), parseFloat(maxlon), parseFloat(maxlat)]);
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

	let analyzefeaturesFromXml = osm => {
		const xmlParser = new XmlParser({progressive: true});

		xmlParser.on('</osm.node>', node => {
			with (node) {
				let nd = new Node(node.$id, refElements);
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

		xmlParser.on('</osm.way>', node => {
			with (node) {
				let way = new Way($id, refElements);
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

		xmlParser.on('<osm.relation>', node => {
			new Relation(node.$id, refElements);
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
				refElements[parent.$id].setBbox([parseFloat($minlon), parseFloat($minlat), parseFloat($maxlon), parseFloat($maxlat)]);
		});

		xmlParser.on('</osm.relation.tag>', (node, parent) => {
			refElements[parent.$id].addTag(node.$k, node.$v);
		});
		
		xmlParser.parse(osm);
	}

	if (osm.elements)
		analyzefeaturesFromJson(osm);
	else
		analyzefeaturesFromXml(osm);

	for (let [k, v] of Object.entries(refElements)) {
		if (v && (v.refCount <= 0 || (renderTagged && v.hasTag && !(v instanceof Way && excludeWay)))) {
			if (v.toFeature) {
				let feature = v.toFeature();
				if (feature) featureArray.push(feature);
			} else if (v.toFeatureArray) {
				featureArray = featureArray.concat(v.toFeatureArray());
				// return the first geometry of the first relation element
				if (!completeFeature && featureArray.length > 0) {
					refElements.cleanup();
					return featureArray[0].geometry;
				}
			}
		}
	}

	refElements.cleanup();
	return {type: 'FeatureCollection', features: featureArray};
}
