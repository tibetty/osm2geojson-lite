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

## Tests

Two layers, both required for new behaviour:

- **Synthetic fixtures** built in the test file (or with `test/pbf-encoder.ts` for
  PBF) pin a specific corner case: stale diff entries, deleted members, invalid
  derived vertices, unsupported PBF compression, truncated containers.
- **Real extracts** under `test/data` (`monaco.osm.pbf` from Geofabrik,
  `monaco-9xx.osc` from its update stream, `history-*.osm` from the OSM API)
  catch whatever the synthetic cases forget. Counts and coordinates in
  `test/pbf-real.test.ts`, `test/osmchange-real.test.ts` and
  `test/history-real.test.ts` are recorded from those committed files.

`test/data.test.ts` sweeps the whole corpus with three option sets and asserts
the invariants a consumer relies on: unique feature ids, well-formed features,
finite coordinates, and that routing a document through `toElements` produces
the same GeoJSON as converting it directly.

Three further layers catch what fixtures cannot:

- `test/fuzz.test.ts` mutates the fixtures byte by byte (seeded) and requires
  either a plain `Error` or well-formed output; `TypeError`, `RangeError` and
  `ReferenceError` are treated as bugs, not as bad input.
- `test/differential.test.ts` compares feature selection with `osmtogeojson` on
  every fixture and geometry exactly on twenty of them. Deliberate differences
  are listed per fixture with a reason, so a new difference fails, and so does
  one that disappears without updating the list.
- `test/property.test.ts` generates documents and diffs and checks the same
  invariants on the combinations no fixture covers.

Coverage thresholds live in `vitest.config.ts`. They are the levels the suite
reaches today, so dropping a code path below them fails `npm test`; raise them
when you add tests, do not lower them to make a build pass. `src/cli.ts` is
excluded because it only runs in a child process (`test/cli.test.ts`, which
skips when `dist/` is missing).

### Auditing released versions

```sh
npm run audit:versions                  # every release from 2.2.0 to the latest
npm run audit:versions -- --from 2.7.0 # a shorter range
npm run audit:versions -- --local-only # only the local dist/ build
```

Each check names the release it became guaranteed in. Every later release must
still pass it, so a regression in any released artifact fails the command; older
releases are reported as `--` for context. Published tarballs are installed once
into `node_modules/.cache/osm2geojson-audit` and reused. This needs network
access, so it is a manual tool rather than part of `npm test`.

### Refreshing real fixtures

Fixtures are frozen on purpose; refresh them deliberately and update the
recorded numbers in the same commit.

- PBF: `https://download.geofabrik.de/europe/monaco-latest.osm.pbf`
- Diffs: `https://download.geofabrik.de/europe/monaco-updates/000/004/<sequence>.osc.gz`
- History: `https://api.openstreetmap.org/api/0.6/{type}/{id}/history`

## Snapshots

`test/expected/*.geojson` are committed fixtures. If you intentionally change output, run `npm run test:update` and commit the diff. Missing fixtures fail the test instead of being regenerated silently.

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
