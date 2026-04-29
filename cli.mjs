#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import osm2geojson from './dist/index.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h'))
{
    process.stdout.write([
        'Convert OpenStreetMap XML or JSON data to GeoJSON.',
        '',
        'Usage:',
        '  npx osm2geojson INPUT_FILE OUTPUT_FILE',
        '  npx osm2geojson < INPUT_FILE > OUTPUT_FILE',
        '',
    ].join('\n'))
} else {
    const inputFile = args[0] ?? "/dev/stdin";
    const outputFile = args[1] ?? "/dev/stdout";

    const data = await readFile(inputFile, "utf-8");
    const geojson = osm2geojson(data, { completeFeature: true, renderTagged: true });
    const geoJsonData = JSON.stringify(geojson);
    await writeFile(outputFile, `${geoJsonData}\n`);
}
