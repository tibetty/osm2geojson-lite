#!/usr/bin/env node

const fs = require('fs'),
	osm2geojson = require('../lib/index.js');

const rounds = 100;
console.log('==========xml processing performance results==========');
const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(`./data/${file}`, 'utf-8');
	console.log(`---processing time for ${file}---`);
	let stime = new Date().getTime();
	for (let i = 0; i < rounds; i++)
		osm2geojson(osm, {completeFeature: true});
	let etime = new Date().getTime();
	console.log(`.${etime - stime}ms was taken for ${rounds} rounds`);
}

console.log('==========json processing performance results==========');
const jsonFiles = ['zhucheng.json', 'hebei.json', 'tokyodo.json', 'usa.json'];
for (let file of jsonFiles) {
	let osm = require(`./data/${file}`);
	console.log(`---processing time for ${file}---`);
	let stime = new Date().getTime();
	for (let i = 0; i < rounds; i++)
		osm2geojson(osm, {completeFeature: true});
	etime = new Date().getTime();
	console.log(`.${etime - stime}ms was taken for ${rounds} rounds`);
}
