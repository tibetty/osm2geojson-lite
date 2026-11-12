import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

export default defineConfig([
    {
        input: 'src/index.ts',
        output: [
            {
                dir: 'dist',
                format: 'esm',
                entryFileNames: 'index.mjs',
            },
            {
                dir: 'dist',
                format: 'cjs',
                entryFileNames: 'index.cjs',
                // The entry mixes a default export with named ones, which makes
                // bundlers expose `module.exports.default`. Keep `require()` a
                // callable function (as it was before named exports existed)
                // and attach the named exports to it.
                exports: 'named',
                footer: 'module.exports = Object.assign(exports.default, exports);',
            },
        ],
    },
    {
        input: 'src/index.ts',
        output: {
            dir: 'dist',
            format: 'esm',
        },
        plugins: [dts({ emitDtsOnly: true })],
    },
    {
        input: 'src/cli.ts',
        external: [/node:.*/],
        output: {
            dir: 'dist',
            format: 'esm',
            entryFileNames: 'cli.mjs',
        },
    },
]);
