const {Node, Way, Relation} = require('./osmobjs.js'),
	{purgeProps, mergeProps, RefElements} = require('./utils.js'),
	XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {
	let refElements = new RefElements(), featureArray = [];

	let analyzefeaturesFromJson = () => {
		for (let elem of osm.elements) {
			switch(elem.type) {
				case 'node':
					let node = new Node(elem.id, refElements);
					node.addTags(mergeProps(elem.tags, purgeProps(elem, ['id', 'type', 'tags', 'lat', 'lon'])));
					node.setCoords([elem.lon, elem.lat]);
					node.addTags(elem.tags);
					break;

				case 'way':
					let way = new Way(elem.id, refElements);
					way.addTags(mergeProps(elem.tags, purgeProps(elem, ['id', 'type', 'tags', 'nodes', 'geometry'])));
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
						relation.addProperty('bbox', [parseFloat(minlon), parseFloat(minlat), parseFloat(maxlon), parseFloat(maxlat)]);
					relation.addTags(mergeProps(elem.tags, purgeProps(elem, ['id', 'type', 'tags', 'bounds', 'members'])));
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
						way.addTag(k.substring(1), v);
				if (node.innerNodes) {
					for (let ind of innerNodes) {
						if (ind.$lon && ind.$lat)
							way.addCoords([ind.$lon, ind.$lat]);
						else if (ind.$ref) {
							way.addNodeRef(ind.$ref);
						}
					}
				}
			}
		});

		xmlParser.on('</osm.node>', node => {
			with (node) {
				let nd = refElements[$id];
				for (let [k, v] of Object.entries(node))
					if (k.startsWith('$') && ['$id', '$lon', '$lat'].indexOf(k) < 0)
						nd.addTag(k.substring(1), v);
				nd.setCoords([$lon, $lat]);
			}
		});

		xmlParser.on('</osm.relation.member>', (node, parent) => {
			with (node) {
				let relation = refElements[parent.$id];
				let member = {
					type: $type,
					role: node.$role? $role : '',
					id: $ref,
					ref: $ref
				};

				if (node.$lat && node.$lon) {
					member.lat = $lat, member.lon = $lon, member.tags = {};
					for (let [k, v] of Object.entries(node))
						if (k.startsWith('$') && ['$type', '$lat', '$lon'].indexOf(k) < 0)
							member.tags[k.substring(1)] = v;
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
				refElements[parent.$id].addProperty('bbox', [parseFloat($minlon), parseFloat($minlat), parseFloat($maxlon), parseFloat($maxlat)]);
		});

		let addTagToParent = (node, parent) => {
			refElements[parent.$id].addTag(node.$k, node.$v);
		}

		xmlParser.on('</osm.node.tag>', addTagToParent);
		xmlParser.on('</osm.way.tag>', addTagToParent);
		xmlParser.on('</osm.relation.tag>', addTagToParent);
		
		xmlParser.parse(osm);
	}

	if (osm.elements)
		analyzefeaturesFromJson(osm);
	else
		analyzefeaturesFromXml(osm);

	for (let [k, v] of Object.entries(refElements)) {
		if (v && v.refCount <= 0) {
			if (v.toFeature) {
				let feature = v.toFeature();
				if (feature) featureArray.push(feature);
			} else if (v.toFeatureArray) {
				featureArray = featureArray.concat(v.toFeatureArray());
			}
		}
	}

	refElements.cleanup();

	if ((!opts || !opts.allFeatures) && featureArray.length > 0)
		return featureArray[0].geometry;

	return {type: 'FeatureCollection', features: featureArray};
}