#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';

import osm2geojson from './index.js';

function printHelp () {
    process.stdout.write([
        'Convert OpenStreetMap XML or JSON data to GeoJSON.',
        '',
        'Usage:',
        '  npx osm2geojson INPUT_FILE OUTPUT_FILE',
        '  npx osm2geojson < INPUT_FILE > OUTPUT_FILE',
        '',
    ].join('\n'))
}

async function main (positionals: Array<string>) {
    const [
        inputFile = "/dev/stdin",
        outputFile = "/dev/stdout",
    ] = positionals;

    const data = await readFile(inputFile, "utf-8");
    const geojson = osm2geojson(data, { completeFeature: true, renderTagged: true });
    const geoJsonData = JSON.stringify(geojson);
    await writeFile(outputFile, `${geoJsonData}\n`);
}

const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        help: {
            short: 'h',
            type: 'boolean',
        },
    },
});

if (values.help)
{
    printHelp();
}
else
{
    main(positionals).catch(err => {
        process.stderr.write(`${err.stack}\n`);
        process.exit(1);
    })
}
