import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

/**
 * One entry per format so a consumer can leave the parsers it does not use out
 * of the bundle. `index` keeps auto-detection and carries all three; the format
 * entries ("xml", "json", "pbf") carry one reader each.
 */
const entries = [
    { input: 'src/index.ts', file: 'index' },
    { input: 'src/entries/xml.ts', file: 'xml' },
    { input: 'src/entries/json.ts', file: 'json' },
    { input: 'src/entries/pbf.ts', file: 'pbf' },
];

/**
 * Every entry mixes a default export with named ones, which makes bundlers
 * expose `module.exports.default`. Keep `require()` callable and attach the
 * named exports to it.
 */
const cjsInterop = 'module.exports = Object.assign(exports.default, exports);';

export default defineConfig([
    ...entries.map(({ input, file }) => ({
        input,
        output: [
            {
                dir: 'dist',
                format: 'esm' as const,
                entryFileNames: `${file}.mjs`,
                // Published bundles are minified: the unminified build is ~2x
                // larger and CDNs serve dist/ as-is. Sources stay readable.
                minify: true,
            },
            {
                dir: 'dist',
                format: 'cjs' as const,
                entryFileNames: `${file}.cjs`,
                exports: 'named' as const,
                footer: cjsInterop,
                minify: true,
            },
        ],
    })),
    ...entries.map(({ input }) => ({
        input,
        output: { dir: 'dist', format: 'esm' as const },
        plugins: [dts({ emitDtsOnly: true })],
    })),
    {
        input: 'src/cli.ts',
        external: [/node:.*/],
        output: {
            dir: 'dist',
            format: 'esm' as const,
            entryFileNames: 'cli.mjs',
            minify: true,
        },
    },
]);
