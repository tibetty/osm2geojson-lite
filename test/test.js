#!/usr/bin/env node

const fs = require('fs'),
	osm2geojson = require('../dist/node');

console.log('========== xml conversion results ==========');
const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm', 'route.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(`./data/${file}`, 'utf-8');
	console.log(`---------- result converted from ${file} ----------`);
	console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true})));
}

console.log('========== json conversion results  ==========');
const jsonFiles = ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json', 'way2.json'];
for (let file of jsonFiles) {
	let osm = require(`./data/${file}`);
	console.log(`---------- result converted from ${file} ----------`);
	console.log(JSON.stringify(osm2geojson(osm, {completeFeature: true})));
}