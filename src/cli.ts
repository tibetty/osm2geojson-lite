#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';

import osm2geojson from './index.js';
import { decodeInput } from './cli-input.js';

function printHelp () {
    process.stdout.write([
        'Convert OpenStreetMap XML, PBF or JSON data to GeoJSON.',
        'Gzip (.gz) and zstd (.zst) input is decompressed automatically.',
        '',
        'Usage:',
        '  npx osm2geojson-lite INPUT_FILE OUTPUT_FILE',
        '  npx osm2geojson-lite < INPUT_FILE > OUTPUT_FILE',
        '',
    ].join('\n'))
}

async function main (positionals: Array<string>) {
    const [
        inputFile = "/dev/stdin",
        outputFile = "/dev/stdout",
    ] = positionals;

    const osm = decodeInput(await readFile(inputFile));
    const geojson = osm2geojson(osm, { completeFeature: true, renderTagged: true });
    const geoJsonData = JSON.stringify(geojson);
    await writeFile(outputFile, `${geoJsonData}\n`);
}

const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
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
