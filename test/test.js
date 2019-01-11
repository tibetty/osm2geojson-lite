const fs = require('fs'),
	DOMParser = require('xmldom').DOMParser,
	osmtogeojson = require('osmtogeojson'),
	osm2geojson = require('../lib/index.js');

console.log('=====xml processing performance comparison=====');
const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(file, 'utf-8');
	console.log(`---processing time comparison for ${file}---`);
	let stime = new Date().getTime();
	osm2geojson(osm, {allFeatures: true});
	let etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by osm2geojson-lite@allFeatures`);

	stime = new Date().getTime();
	const osmdom = new DOMParser().parseFromString(osm);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xmldom only`);
	osmtogeojson(osmdom);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by xmldom + osmtogeojson`);
}

console.log('=====json processing performance comparison=====');
const jsonFiles = ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json'];
for (let file of jsonFiles) {
	let osm = require('./' + file);
	console.log(`---processing time comparison for ${file}---`);
	let stime = new Date().getTime();
	osm2geojson(osm, {allFeatures: true});
	let etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by osm2geojson-lite@allFeatures`);

	stime = new Date().getTime();
	osmtogeojson(osm);
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms costed by osmtogeojson`);
}
