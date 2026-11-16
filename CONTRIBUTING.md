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
| `npm run build` | Build `dist/` (entries `index`, `xml`, `json` and `pbf`) |
| `npm run bench` | Compare against `osm2geojson-ultra` and `osmtogeojson` |
| `npm run footprint` | Compare app bundle sizes with `osmtogeojson` (run `npm run build` first) |
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

Synthetic documents have to stay inside the OSM data model - a fixture that no
source could produce locks in behaviour for input that never occurs.
`assertValidOsmDocument` (`test/support/osm-document.ts`) runs through the JSON
helpers in `features`, `overpass`, `duplicates`, `history` and `apply-change`,
and over the whole real corpus in `test/data.test.ts`, so a rule stricter than
OSM itself fails on real data. A document that is deliberately outside the model
- an invalid coordinate, an out-of-order bound - passes
`{ outsideOsmModel: true }` and says why in a comment. The same module states the
provenance convention: synthetic documents are constructed, so a case that
mirrors a real object names it, and a case no real object can produce says so
(for example the nested islands behind #138).

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

### Bundle tests

`npm run build` emits four entries: `index` (auto-detecting) and `xml`, `json`,
`pbf` (one reader each, built from `src/entries/`). `test/entries.test.ts` reads
`dist/` and skips without a build; it asserts that each format entry converts
its own format exactly like the default entry, rejects the others, keeps the
excluded parser's code out of its bundle (string markers) and stays under a
size ceiling. Raising a ceiling needs a size measurement in the PR.

### Auditing released versions

```sh
npm run audit:versions                  # every release from 2.2.0 to the latest
npm run audit:versions -- --from 2.7.0 # a shorter range
npm run audit:versions -- --local-only # only the local dist/ build
```

Each check names the release it became guaranteed in. Every later release must
still pass it, so a regression in any released artifact fails the command; older
releases are reported as `--` for context. Published tarballs are installed once
into `node_modules/.cache/osm2geojson-audit` and reused. `npm test` runs it as
part of the suite: it needs network access, so offline it reports `SKIP` and
audits the local build only, while CI (where `CI` is set) treats an unreachable
registry as a failure.

### Refreshing real fixtures

Fixtures are frozen on purpose; refresh them deliberately and update the
recorded numbers in the same commit.

- Indonesia boundary (`test/data/indonesia.json`): Overpass `rel(304751); out geom;`
  — one 186-way outer loop plus two enclave rings, so it exercises stitching at
  scale rather than nesting
- Ring-heavy relations, all fetched with `out geom`:
  - Lake Toba `rel(306034)` — one lake ring with island holes (19 after merging)
  - Baarle-Nassau `rel(47798)` — Dutch municipality around Belgian enclaves
    (9 polygons, 22 holes)
  - Baarle-Hertog `rel(53137)` — Belgian exclaves (25 polygons, 8 holes)

  These three are breadth, not regression tests: converting them with the 2.8.2
  code produces byte-identical output, because in each of them an inner ring lies
  in exactly one outer ring. The nested-island case that #138 broke needs outsides
  that nest, which real relations rarely contain - that is why
  `test/data/nested-island.json` is synthetic.
- Overpass derived geometry (`test/data/overpass-derived-geometry.{osm,json}`),
  the only real witnesses for the derived XML paths:

  ```text
  [out:xml];
  (node(624443328);way(257071677);way(335197685);relation(1939701););
  convert item ::=::,::geom=geom(),_osm_type=type();
  out geom;
  ```

  The same query with `[out:json]` produced the `.json` twin; both must convert
  identically, which `test/data.test.ts` asserts. In XML the geometry arrives
  as `<point>` (node), bare `<vertex>` (ways) and `<group>` (the multipolygon
  relation). A `<linestring>` element cannot be produced from an OSM object -
  Overpass emits it only for a geometry built with `lstr()` - so that shape has
  no real capture and stays synthetic.
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

Not every merge is a release. A version bump publishes to npm, so it is reserved
for changes a consumer can observe.

| change | action |
| --- | --- |
| behaviour, API, types, dist, export map | bump and release |
| `test/data`, `test/expected`, test-only code | merge only - no npm release, no changelog entry |
| docs, comments, CI, workflow tweaks | merge only |
| performance with identical output | bump and release (the artifact changed) |

A test-only change that needs the corpus on `main` is just a PR and a merge; the
fixtures are not part of the published package (`files` is `dist`, README and
LICENSE).

Documentation follows the same rule, with one consequence worth knowing: npm renders
the package page from the README inside the published tarball, so a README merged
without a release keeps the previous wording on npm until the next release that
warrants one. That is accepted - docs are corrected in `main` and ride along.

When a release is warranted, maintainers:

1. Merge the fix/feature PR.
2. Run the **Create version bump PR** workflow (`patch`/`minor`/`major`).
3. Merge the generated version PR.
4. `release.yml` builds and runs `npm test` on the merge commit, waits for
   approval on the `npm-publish` environment, then publishes to npm via trusted
   publishing and creates the tag/release.

The publish step runs behind the `npm-publish` environment: its required
reviewers are the maintainers and **Prevent self-review** is on, so a release
triggered by one maintainer's merge needs the other to approve it. The
environment name must also be set as the **Environment name** on the package's
trusted publisher at npmjs.com (package → Settings → Trusted publishing). If the
two disagree the OIDC exchange fails with `404 ... could not be found`, which
reads like a missing package rather than a claim mismatch, so rename it in both
places or in neither.

The two sides can be compared without publishing:

```sh
npm trust list osm2geojson-lite --json
```

```json
{
  "type": "github",
  "file": "release.yml",
  "repository": "tibetty/osm2geojson-lite",
  "environment": "npm-publish",
  "permissions": ["createPackage", "createStagedPackage"]
}
```

`createPackage` is the permission `npm publish` needs. `createStagedPackage` is
the stage queue, which this repository does not use: the environment approval is
the human gate, so a second one on npmjs.com would be redundant.

The release job is idempotent: the publish step skips a version that is already
on the registry, and the tag step skips a tag that already exists, so a run that
failed after either step can be retried with **Run workflow** on `release.yml`.
It is safe to re-run at any commit whose `package.json` differs from its parent.

The test step is a gate, not a duplicate of CI. `CI` and `Release` both trigger
on the same push and run in parallel, so without it a version bump merged into a
red `main` would publish anyway. It runs the same `npm test` the PR went
through, including the version audit.

Before changing `release.yml`, dispatch the **Release smoke test** workflow: it
runs the release-only steps (npm pack, tag computation, tag creation and push,
archive) without publishing anything or keeping a tag. It cannot cover the
environment approval or the OIDC exchange: a dry run never authenticates against
the registry.

## Community

- Use the issue templates.
- Be respectful and assume good intent.
- For design decisions, use the issue thread to record the options and compatibility impact before implementing.
