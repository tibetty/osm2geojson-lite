import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Benchmarks are run by `npm run bench`, not by the test suite.
        include: ['test/**/*.test.ts'],
        // The corpus converts multi-megabyte fixtures and the differential runs
        // osmtogeojson over them; 5s is not enough on a shared CI runner.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // `src/cli.ts` runs in a child process (see test/cli.test.ts), so
            // in-process coverage cannot see it.
            exclude: ['src/cli.ts'],
            // Baselines are what the suite reaches today, so a change that stops
            // exercising a branch fails CI instead of quietly lowering coverage.
            thresholds: {
                statements: 94,
                branches: 89,
                functions: 98,
                lines: 94,
            },
        },
    },
});
