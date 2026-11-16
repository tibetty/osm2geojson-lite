import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import osm2geojsonLite, { mergeOsmChange } from 'osm2geojson-lite';
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
    test(`${name} · XML → GeoJSON`, async ({ bench }) => {
        await bench.compare(
            bench('osm2geojson-lite', () => {
                osm2geojsonLite(xml, opts);
            }),
            bench('osm2geojson-ultra', () => {
                osm2geojsonUltra(xml, opts);
            }),
            bench('osmtogeojson + xmldom', () => {
                osmtogeojson(new DOMParser().parseFromString(xml, 'text/xml'));
            }),
        );
    });
}

// JSON (Overpass) → GeoJSON. Parsed once up front so the benchmark measures
// conversion rather than JSON.parse.
for (const name of datasets) {
    const json = JSON.parse(read(`${name}.json`));
    test(`${name} · JSON → GeoJSON`, async ({ bench }) => {
        await bench.compare(
            bench('osm2geojson-lite', () => {
                osm2geojsonLite(json, opts);
            }),
            bench('osm2geojson-ultra', () => {
                osm2geojsonUltra(json, opts);
            }),
            bench('osmtogeojson', () => {
                osmtogeojson(json);
            }),
        );
    });
}

// The element-dense document, and the only row that measures per-element work
// rather than boundary flattening: the Monaco PBF merged with a real diff.
// `test/osmchange-real.test.ts` asserts the same document has 48,472 unique
// elements, and the README's "within about 10%" figure is this row.
const dense = mergeOsmChange(
    new Uint8Array(fs.readFileSync(dataDir + 'monaco.osm.pbf')),
    read('monaco-900.osc'),
);
// The README's dense figure is 10,664 output features, which needs every way
// rendered.
const denseOpts = { completeFeature: true, renderTagged: true, excludeWay: false };
// Only the two libraries the README compares on this shape: one conversion is
// ~55ms and the fixed sample count is 64, so adding `osm2geojson-ultra`
// (1.1s on the same document) turns this row into a 100-second benchmark.
test('monaco merged · element-dense', { timeout: 300_000 }, async ({ bench }) => {
    await bench.compare(
        bench('osm2geojson-lite', () => {
            osm2geojsonLite(dense, denseOpts);
        }),
        bench('osmtogeojson', () => {
            osmtogeojson(dense);
        }),
    );
});
