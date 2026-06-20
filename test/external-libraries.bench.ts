import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bench, describe } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import osm2geojsonLite from '../src/index';
import osm2geojsonUltra from 'osm2geojson-ultra';
import osmtogeojson from 'osmtogeojson';

const dataDir = fileURLToPath(new URL('./data/', import.meta.url));
// Strip a leading UTF-8 BOM so every parser gets identical input (xmldom
// rejects an XML declaration that is preceded by a BOM).
const read = (file: string): string =>
    fs.readFileSync(dataDir + file, 'utf-8').replace(/^\uFEFF/, '');

const opts = { completeFeature: true };
const datasets = ['zhucheng', 'hebei', 'tokyodo', 'usa'];

// XML (.osm) → GeoJSON. osmtogeojson needs a pre-parsed DOM, so the cost of
// parsing the XML is included in its case to keep the comparison fair.
for (const name of datasets) {
    const xml = read(`${name}.osm`);
    describe(`${name} · XML → GeoJSON`, () => {
        bench('osm2geojson-lite', () => {
            osm2geojsonLite(xml, opts);
        });
        bench('osm2geojson-ultra', () => {
            osm2geojsonUltra(xml, opts);
        });
        bench('osmtogeojson + xmldom', () => {
            osmtogeojson(new DOMParser().parseFromString(xml, 'text/xml'));
        });
    });
}

// JSON (Overpass) → GeoJSON. Parsed once up front so the benchmark measures
// conversion rather than JSON.parse.
for (const name of datasets) {
    const json = JSON.parse(read(`${name}.json`));
    describe(`${name} · JSON → GeoJSON`, () => {
        bench('osm2geojson-lite', () => {
            osm2geojsonLite(json, opts);
        });
        bench('osm2geojson-ultra', () => {
            osm2geojsonUltra(json, opts);
        });
        bench('osmtogeojson', () => {
            osmtogeojson(json);
        });
    });
}
