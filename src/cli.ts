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
        '  npx osm2geojson-lite [options] INPUT_FILE OUTPUT_FILE',
        '  npx osm2geojson-lite [options] < INPUT_FILE > OUTPUT_FILE',
        '',
        'Options:',
        '  --keep-ways         also emit tagged ways that relations already use',
        '  --tainted           mark features with missing references as @tainted',
        '  --element TYPE/ID   output only that feature, e.g. --element way/123',
        '  -h, --help          show this help',
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

interface CliOptions {
    'keep-ways'?: boolean;
    tainted?: boolean;
    element?: string;
}

async function main (positionals: Array<string>, options: CliOptions) {
    const [inputFile, outputFile] = positionals;

    const data = inputFile ? await readFile(inputFile) : await readStdin();
    const osm = decodeInput(data);
    const geojson = osm2geojson(osm, {
        completeFeature: true,
        renderTagged: true,
        excludeWay: !options['keep-ways'],
        tainted: options.tainted === true,
        elementId: options.element,
    });
    if (geojson === undefined) {
        throw new Error(`${options.element} is not in the input or has no geometry`);
    }
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
        'keep-ways': {
            type: 'boolean',
        },
        tainted: {
            type: 'boolean',
        },
        element: {
            type: 'string',
        },
    },
});

if (values.help)
{
    printHelp();
}
else
{
    main(positionals, values).catch(err => {
        process.stderr.write(`${err.stack}\n`);
        process.exit(1);
    })
}
