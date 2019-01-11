const {Node, Way, Relation} = require('./osmobjs.js'),
	{RefElements} = require('./utils.js'),
	XmlParser = require('./xmlparser.js');

module.exports = (osm, opts) => {
	let refElements = new RefElements(), featureArray = [];

	let analyzefeaturesFromJson = () => {
		for (let elem of osm.elements) {
			switch(elem.type) {
				case 'node':
					let node = new Node(elem.id, refElements);
					if (elem.tags) node.addTags(elem.tags);
					node.setCoords([elem.lon, elem.lat]);
					node.addTags(elem.tags);
					break;

				case 'way':
					let way = new Way(elem.id, refElements);
					if (elem.tags) way.addTags(elem.tags);
					if (elem.nodes)
						for (let n of elem.nodes)
							way.addNodeRef(n);
					else if (elem.geometry)
						for (let g of elem.geometry)
							way.addCoords([g.lon, g.lat]);
					break;

				case 'relation':
					let relation = new Relation(elem.id, refElements);
					if (elem.bounds)
						with (elem.bounds)
							relation.addProperty('bbox', [parseFloat(minlon), parseFloat(minlat), parseFloat(maxlon), parseFloat(maxlat)]);
					if (elem.tags) relation.addTags(elem.tags);
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

		xmlParser.addListener('<osm.relation>', node => {
				new Relation(node.$id, refElements);
		});

		xmlParser.addListener('</osm.way>', node => {
			with (node) {
				let way = new Way($id, refElements);
				if (node.innerNodes) {
					for (let nd of innerNodes) {
						if (nd.$lon && nd.$lat)
							way.addCoords([nd.$lon, nd.$lat]);
						else if (nd.$ref) {
							way.addNodeRef(nd.$ref);
						}
					}
				}
			}
		});

		xmlParser.addListener('</osm.node>', node => {
			with (node) {
				let nd = new Node($id, refElements);
				nd.setCoords([$lon, $lat]);
				if (node.innerNodes)
					for (let tag of innerNodes)
						nd.addTag(tag.$k, tag.$v);
			}
		});

		xmlParser.addListener('<osm.relation>', (node, parent) => {
			with (node) {
				new Relation($id, refElements);
			}
		});

		xmlParser.addListener('</osm.relation.member>', (node, parent) => {
			with (node) {
				let relation = refElements[parent.$id];
				let member = {
					type: $type,
					role: node.$role? $role : '',
					id: $ref,
					ref: $ref
				};

				if (node.$lat && node.$lon) {
					member.lat = $lat, member.lon = $lon;
					member.tags = {};
					let entries = Object.entries(node);
					for (let [k, v] of entries) {
						if (k.startsWith('$') && ['$lat', '$lon', '$type'].indexOf(k) < 0)
							member.tags[k.substring(1)] = v;
					}
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

		xmlParser.addListener('</osm.relation.bounds>', (node, parent) => refElements[parent.$id].addProperty('bbox', [parseFloat(node.$minlon), parseFloat(node.$minlat), parseFloat(node.$maxlon), parseFloat(node.$maxlat)]));

		xmlParser.addListener('</osm.relation.tag>', (node, parent) => {
			refElements[parent.$id].addTag(node.$k, node.$v)
		});
		
		xmlParser.parse(osm);
	}

	if (osm.elements)
		analyzefeaturesFromJson(osm);
	else
		analyzefeaturesFromXml(osm);

	let entries = Object.entries(refElements);
	for (let [k, v] of entries) {
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