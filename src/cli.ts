#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';

import osm2geojson from './index.js';

function printHelp () {
    process.stdout.write([
        'Convert OpenStreetMap XML, PBF or JSON data to GeoJSON.',
        '',
        'Usage:',
        '  npx osm2geojson-lite INPUT_FILE OUTPUT_FILE',
        '  npx osm2geojson-lite < INPUT_FILE > OUTPUT_FILE',
        '',
    ].join('\n'))
}

/**
 * PBF is a binary container, XML and JSON start with '<' or '{'. Sniffing the
 * content instead of the file extension keeps stdin working.
 */
function looksLikeText (data: Buffer) {
    let i = 0;
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
        i = 3;
    }
    while (i < data.length && (data[i] === 0x20 || data[i] === 0x09 || data[i] === 0x0a || data[i] === 0x0d)) {
        i++;
    }
    return data[i] === 0x3c || data[i] === 0x7b;
}

async function main (positionals: Array<string>) {
    const [
        inputFile = "/dev/stdin",
        outputFile = "/dev/stdout",
    ] = positionals;

    const data = await readFile(inputFile);
    const osm = looksLikeText(data) ? data.toString('utf-8') : data;
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
