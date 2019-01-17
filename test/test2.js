#!/usr/bin/env node

const fs = require('fs'),
	osm2geojson = require('../lib/index.js');

const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm'];
for (let file of xmlFiles) {
	console.log(`------------------------------${file}------------------------------`);
	let osm = fs.readFileSync(`./data/${file}`, 'utf-8');
	console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true, renderTagged: true})));
}

const jsonFiles = ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json'];
for (let file of jsonFiles) {
	console.log(`------------------------------${file}------------------------------`);
	let osm = require(`./data/${file}`);
	console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true, renderTagged: true})));
}
