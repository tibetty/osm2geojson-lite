#!/usr/bin/env node

const fs = require('fs'),
	DOMParser = require('xmldom').DOMParser,
	osmtogeojson = require('osmtogeojson'),
	osm2geojson = require('../.');

console.log('========== xml conversion results side by side ==========');
const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(`./data/${file}`, 'utf-8');
	console.log(`---------- osm2geojson-lite from ${file} ----------`);
	console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true})));
	console.log(`---------- osmtogeojson from ${file} ----------`);
	const osmdom = new DOMParser().parseFromString(osm);
	console.log(JSON.stringify(osmtogeojson(osmdom)));
}

console.log('========== json conversion results side by side ==========');
const jsonFiles = ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json'];
for (let file of jsonFiles) {
	let osm = require(`./data/${file}`);
	console.log(`---------- osm2geojson-lite from ${file} ----------`);
        console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true})));
        console.log(`---------- osmtogeojson from ${file} ----------`);
	console.log(JSON.stringify(osmtogeojson(osm)));
}
