# Contributing

Thanks for helping improve `osm2geojson-lite`.

## Requirements

- Node.js version from [`.nvmrc`](./.nvmrc)
- npm

## Setup

```sh
git clone https://github.com/tibetty/osm2geojson-lite.git
cd osm2geojson-lite
npm ci
```

## Useful commands

| Command | Purpose |
|---|---|
| `npm test` | Run the full test suite with coverage |
| `npx tsc --noEmit` | Type-check |
| `npm run build` | Build `dist/` |
| `npm run bench` | Compare against `osm2geojson-ultra` and `osmtogeojson` |
| `npm run valid` | Build, serve the repo on port 3000 and open the playground |

A CI-equivalent local check is:

```sh
npm test
npx tsc --noEmit
npm run build
```

## Before opening a pull request

- Add or update tests. For bug fixes, add a regression test that fails before the fix.
- Run `npm test`, `npx tsc --noEmit` and `npm run build`.
- For performance work, run `npm run bench` and include before/after numbers, the dataset/fixture used and the machine details.
- Keep runtime dependencies at **zero**. New dev dependencies need a clear justification.
- Update `README.md` and `CHANGELOG.md` for user-visible behavior.
- Link the issue with `Fixes #123` in the PR description.
- Keep the PR focused; split unrelated changes.

## Snapshots

`test/expected/*.geojson` are committed fixtures. Review snapshot diffs carefully and include intentional changes in the PR. (Making missing-fixture regeneration fail by default is tracked in #66.)

## Performance work

- Reproduce the problem with a fixture first.
- Benchmark before and after on the same machine.
- Prefer algorithmic fixes over micro-optimizations.
- Keep behavior identical unless the linked issue explicitly changes semantics.

## Releasing

Maintainers:

1. Merge the fix/feature PR.
2. Run the **Create version bump PR** workflow (`patch`/`minor`/`major`).
3. Merge the generated version PR.
4. `release.yml` publishes to npm via trusted publishing and creates the tag/release.

## Community

- Use the issue templates.
- Be respectful and assume good intent.
- For design decisions, use the issue thread to record the options and compatibility impact before implementing.
