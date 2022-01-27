#!/usr/bin/env node

const fs = require('fs'),
	DOMParser = require('xmldom').DOMParser,
	osmtogeojson = require('osmtogeojson');

const rounds = 100;
console.log('==========xml processing performance results==========');
const xmlFiles = ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm'];
for (let file of xmlFiles) {
	let osm = fs.readFileSync(`./data/${file}`, 'utf-8');
	console.log(`---processing ${file}---`);
	let stime = new Date().getTime();
	for (let i = 0; i < rounds; i++) {
		const osmdom = new DOMParser().parseFromString(osm);
		osmtogeojson(osmdom);
	}
	let etime = new Date().getTime();
	console.log(`-> ${etime - stime}ms was taken for ${rounds} rounds`);
}

console.log('==========json processing performance results==========');
const jsonFiles = ['zhucheng.json', 'hebei.json', 'tokyodo.json', 'usa.json'];
for (let file of jsonFiles) {
	let osm = require(`./data/${file}`);
	console.log(`---processing ${file}---`);
	let stime = new Date().getTime();
	for (let i = 0; i < rounds; i++)
		osmtogeojson(osm);
	etime = new Date().getTime();
	console.log(`-> ${etime - stime}ms was taken for ${rounds} rounds`);
}
