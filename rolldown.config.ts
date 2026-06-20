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
