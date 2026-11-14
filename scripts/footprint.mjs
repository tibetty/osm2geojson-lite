#!/usr/bin/env node
/**
 * Bundle footprint: what an application actually ships when it converts OSM
 * data, for this library and for `osmtogeojson`.
 *
 *   npm run build && npm run footprint
 *
 * Both sides are bundled the same way, so the numbers are comparable: minified
 * ESM through rolldown, measured raw and gzipped with the bundled `node:zlib`.
 * This library's sizes are its published artifacts (`dist/*.mjs`); the
 * competitor's are bundled from its npm package the way an app would import
 * it, because it ships an unminified CommonJS entry plus runtime dependencies.
 *
 * `osmtogeojson` has no single number: its browser build converts Overpass JSON
 * only, XML text needs a caller-supplied DOM (or its htmlparser2-based parser in
 * Node), and PBF is not an input at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { build } from 'rolldown';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);

const sizes = (file) => {
    const bytes = fs.readFileSync(file);
    return { raw: bytes.length, gzip: gzipSync(bytes).length };
};

/**
 * Bundle one temporary entry, minified like a production app. The entry lives
 * under `node_modules/.cache` so the competitor's package resolves from this
 * repo's install rather than from a system temp directory.
 */
const bundle = async (name, source) => {
    const dir = path.join(repo, 'node_modules', '.cache', 'footprint');
    fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, `${name}.js`);
    fs.writeFileSync(entry, source);
    const out = path.join(dir, `${name}.mjs`);
    await build({ input: entry, output: { file: out, format: 'esm', minify: true } });
    const size = sizes(out);
    if (size.raw < 1024) {
        throw new Error(`bundling ${name} produced ${size.raw} B: the package did not resolve`);
    }
    return size;
};

const installedBytes = (names) => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .reduce((sum, entry) => sum + (entry.isDirectory() ? walk(path.join(dir, entry.name)) : fs.statSync(path.join(dir, entry.name)).size), 0);
    return names.reduce((sum, name) => sum + walk(path.join(repo, 'node_modules', name)), 0);
};

const ourDist = path.join(repo, 'dist');
if (!fs.existsSync(path.join(ourDist, 'index.mjs'))) {
    process.stderr.write('dist/ is missing: run `npm run build` first.\n');
    process.exit(1);
}

const rows = [
    ['JSON objects', sizes(path.join(ourDist, 'json.mjs')), await bundle('their-json', "export { default } from 'osmtogeojson';")],
    ['XML text (Node)', sizes(path.join(ourDist, 'xml.mjs')),
        await bundle('their-xml', "export { default } from 'osmtogeojson';\nexport { default as parseXml } from 'osmtogeojson/parse_osmxml.js';")],
    ['PBF', sizes(path.join(ourDist, 'pbf.mjs')), await bundle('their-pbf', "export { default } from 'tiny-osmpbf';")],
    ['XML + JSON + PBF', sizes(path.join(ourDist, 'index.mjs')), null],
];

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const cell = (size) => (size === null ? '—' : `${kib(size.raw)} / ${kib(size.gzip)} gz`).padEnd(26);

process.stdout.write(`\n${'conversion'.padEnd(18)}${'osm2geojson-lite'.padEnd(26)}osmtogeojson\n`);
process.stdout.write(`${'-'.repeat(70)}\n`);
for (const [label, ours, theirs] of rows) {
    process.stdout.write(`${label.padEnd(18)}${cell(ours)}${cell(theirs)}\n`);
}

const theirPackage = require(path.join(repo, 'node_modules', 'osmtogeojson', 'package.json'));
const theirDeps = [theirPackage.name, ...Object.keys(theirPackage.dependencies || {})];
const ourDeps = Object.keys(require(path.join(repo, 'package.json')).dependencies || {});

process.stdout.write(`
Install footprint
  osm2geojson-lite  ${ourDeps.length} runtime dependencies
  osmtogeojson       ${Object.keys(theirPackage.dependencies || {}).length} runtime dependencies, ${(installedBytes(theirDeps) / 1024 / 1024).toFixed(1)} MiB on disk

Notes
  - The PBF row compares this library's full PBF -> GeoJSON path with
    osmtogeojson's decoder dependency alone: its converter has no PBF input.
  - The XML row uses osmtogeojson's htmlparser2-based parser; its prebuilt
    browser build converts Overpass JSON only and expects a caller-provided DOM
    for XML, so browser XML cost mostly sits outside the number above.
  - Bundling osmtogeojson's XML path needs a \`util\` polyfill: htmlparser2 3.5.1
    pulls it in at load.
`);
