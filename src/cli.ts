#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

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

/**
 * Read the whole of stdin. `/dev/stdin` is not portable: on Linux it is a
 * symlink to a pipe for `cat file | cli` and opening it fails with ENXIO.
 */
function readStdin (): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Array<Buffer> = [];
        process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
        process.stdin.on('error', reject);
    });
}

function writeStdout (payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
        process.stdout.write(payload, (error) => (error ? reject(error) : resolve()));
    });
}

async function main (positionals: Array<string>) {
    const [inputFile, outputFile] = positionals;

    const data = inputFile ? await readFile(inputFile) : await readStdin();
    const osm = decodeInput(data);
    // The CLI only runs on Node, so it always uses the native decompressor.
    // Corruption therefore reports zlib's message rather than the bundled one.
    const geojson = osm2geojson(osm, {
        completeFeature: true,
        renderTagged: true,
        inflate: (block) => inflateSync(block),
    });
    const payload = `${JSON.stringify(geojson)}\n`;

    if (outputFile) {
        await writeFile(outputFile, payload);
        return;
    }
    await writeStdout(payload);
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
