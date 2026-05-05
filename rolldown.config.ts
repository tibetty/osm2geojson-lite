import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

export default defineConfig([
    {
        input: 'src/index.ts',
        output: [
            {
                dir: 'dist',
                format: 'cjs',
                entryFileNames: 'index.js',
            },
            {
                dir: 'dist',
                format: 'esm',
                entryFileNames: 'index.mjs',
            },
        ],
    },
    {
        input: 'src/index.ts',
        output: {
            dir: 'dist',
            format: 'esm',
        },
        plugins: [dts()],
    }
]);