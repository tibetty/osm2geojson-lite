const fs = require('fs'),
	osm2geojson = require('../lib/index.js');

const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(file, 'utf-8');
	console.log('---------------------------------------------------------------------')
	console.log(JSON.stringify(osm2geojson(osm, {allFeatures: true})));
}

const jsonFiles = ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json'];
for (let file of jsonFiles) {
	file = './' + file;
	let osm = require(file);
	console.log('---------------------------------------------------------------------')
	console.log(JSON.stringify(osm2geojson(osm, {allFeatures: true})));
}
