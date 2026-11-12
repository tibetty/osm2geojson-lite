<p align="center"><img src="favicon.png" width="128" alt="osm2geojson-lite icon"></p>

osm2geojson-lite
============

[![NPM Version](https://img.shields.io/npm/v/osm2geojson-lite)](https://www.npmjs.com/package/osm2geojson-lite) [![Codecov](https://img.shields.io/codecov/c/github/tibetty/osm2geojson-lite/main.svg)](https://codecov.io/gh/tibetty/osm2geojson-lite/)


A full-featured, dependency-free convertor from [OpenStreetMap](http://openstreetmap.org) [data](http://wiki.openstreetmap.org/wiki/OSM_XML) to [GeoJSON](http://www.geojson.org/), implemented in pure JavaScript. It reads every OSM data format that carries geometry - OSM XML, osmChange diffs, PBF and Overpass JSON - covers the OSM data model end to end, and converts 10-18x faster than `osmtogeojson` on XML and 13-57x on JSON.

What that covers:

- **Inputs** - OSM XML, osmChange (`.osc`), OSM PBF (`.osm.pbf`), Overpass XML/JSON including `out geom`, `out center`, `out bb`, `convert`, `make` and `local`, and gzip/zstd containers in the CLI.
- **OSM semantics** - multipolygons and boundaries with inner-ring assignment, routes, old-style multipolygons, member roles (outer/inner/subarea/platform/stop), relation cycles and super-relations, `area` polygon rules.
- **History and changes** - full history extracts resolve to the newest version, deletions remove elements and taint the references to them, and an osmChange can be applied to a base extract with conflict reporting.
- **Output** - `FeatureCollection`, a single element by id, or merged element documents, all RFC 7946 compliant, in Node and in the browser.

History
-----
An internal function inside [query-geo-boundary](https://www.npmjs.com/package/query-geo-boundary) &rightarrow; stripped out to handle OSM XML only [xml2geojson-lite](https://www.npmjs.com/package/xml2geojson-lite) &rightarrow; this library, which grew from XML and Overpass JSON to the full set above.

Usage
-----

### As a Node.JS Library

Installation:

    $ npm install osm2geojson-lite

Usage:

```js
    import osm2geojson from 'osm2geojson-lite';
    let geojson = osm2geojson(osm, opts);
```

CommonJS works the same way, and the named helpers are available on the same
callable:

```js
    const osm2geojson = require('osm2geojson-lite');
    const { applyOsmChange, mergeOsmChange, toElements } = require('osm2geojson-lite');

    let geojson = osm2geojson(osm, opts);
```

### In the Browser

Modern browsers load the ESM build directly via `<script type="module">`. Import it from a CDN (e.g. [esm.sh](https://esm.sh) or [jsDelivr](https://www.jsdelivr.com)):

```html
    <script type="module">
        import osm2geojson from 'https://esm.sh/osm2geojson-lite';

        const geojson = osm2geojson(osm, opts);
    </script>
```

### In the command line
```sh
    npx osm2geojson-lite --help
    npx osm2geojson-lite monaco.osm.pbf monaco.geojson
```

The CLI reads the input as bytes, decompresses gzip (`.gz`) and zstd (`.zst`)
containers, and sniffs whether the payload is text (XML/JSON) or binary (PBF),
so extensions do not matter and stdin still works. `bzip2` and `xz` are
rejected with a hint, because Node ships no decoder for them.

API
---

### `osm2geojson(osm, opts)`

Converts OSM data to GeoJSON.

* `osm`: OSM XML or osmChange XML in a string, OSM/Overpass JSON as an object or a string, or OSM PBF as a `Uint8Array` / `ArrayBuffer`
* `opts?`: optional, the options object, right now supports below properties/fields:
    - `completeFeature`:  the default value is `false`. When it's set to `true`, the returned geojson will include all elements that meet the specified conditions in `FeatureCollection` format; otherwise, only the bare geometry of the first `relation` element will be returned.
    - `renderTagged`: the default value is `false`. When it's set to `true`, the returned geojson will include all elements with tags (i.e., tagged) until `excludeWay` changes its behavior a bit; otherwise only the unreferenced ones get returned.
    - `excludeWay`: the default value is `true`. When it's set to `true`, the returned `FeatureCollection` will exclude all referenced `way`s even though they are tagged; otherwise the features of those `way`s will be included in the resulted result as well.
    - `elementId`: optional, an OSM element id in the form `type/id` (e.g. `way/123`). When set, only that single `Feature` is returned; `undefined` is returned when the element does not exist.
    - `tainted`: the default value is `false`. When set to `true`, features whose referenced nodes/ways/relations are missing (e.g. partial Overpass responses) receive an `@tainted: true` property.
    - `polygonTags`: optional, alternative polygon tag rules for ways. The shape matches the bundled `polytags.json`, e.g. `{ "building": { "ignore": ["no"] } }`; the legacy `whitelist`/`blacklist` spellings are still accepted.

### Input formats

- **XML**: `<osm>` extracts and `<osmChange>` (`.osc`) diffs. `node`, `way` and `relation` elements are read inside `<create>`, `<modify>` and `<delete>` sections.
- **JSON**: OSM/Overpass JSON, as an object or a JSON string.
- **PBF**: OSM PBF (`.osm.pbf`) byte buffers. Blobs are inflated by a bundled synchronous zlib/DEFLATE decoder, so PBF needs neither `node:zlib` nor a third-party package. `lzma`, `bzip2`, `lz4` and `zstd` blobs, and unknown required features, are rejected with an error.

The library does not uncompress files: pass decompressed data. Handing it
gzip/zstd bytes raises an error naming the container, and the CLI decompresses
them for you.

### Deletions and history

- Deleted elements produce no geometry: elements inside an osmChange `<delete>` section, elements carrying `action="delete"` (XML or JSON) and elements with `visible=false`.
- History extracts (`.osh`, Overpass `[adiff]` or `out meta`) are resolved to the newest version of each element; older versions contribute no tags or geometry. A deletion at the newest version removes the element, and references to it stay unresolved, so the referencing feature gets `@tainted` when the `tainted` option is enabled.
- Copies of the same version are still merged, because Overpass can return one element twice with complementary data; copies without a version are treated as incomplete duplicates.

### Applying an osmChange to a base

A diff can be applied to a base extract, so a daily `.osc` can update a cached area without re-downloading it:

```js
import { applyOsmChange, mergeOsmChange, toElements } from 'osm2geojson-lite';

const { geojson, conflicts } = applyOsmChange(base, diff, opts);

const merged = mergeOsmChange(base, diff);    // { elements, conflicts }
const elements = toElements(base);            // current state of any input
```

- `toElements(input)` normalises XML, PBF or JSON into element objects, collapsing duplicate and multi-version copies to the newest version and dropping elements deleted at their newest version.
- `mergeOsmChange(base, diff)` applies a diff at the element level: a modification only overrides a base it advances, a deletion applies when the base is at or below the version named in the diff (an osmChange delete carries the version being deleted, not a new one), elements missing from the base are appended as creates, and stale entries leave the base intact. They are reported as `{ id, changeVersion, baseVersion }` in `conflicts`, and `{ strict: true }` turns the first conflict into an error instead.
- `applyOsmChange(base, diff)` merges and converts in one call, returning `{ geojson, conflicts }`.
- Base and diff can be any supported input, in any combination — a PBF base with an `.osc` diff, an XML base with an osmChange, and so on.

### Coordinate handling

- Missing `null` entries in `out geom` are skipped. The remaining valid points are joined into one line and the feature is marked `@tainted` when the `tainted` option is enabled. This mirrors `osmtogeojson`; it does not split the line at every gap.
- Invalid bounds or center values are ignored rather than emitted as `NaN`.
- A JSON element carrying an explicit GeoJSON `geometry` object is passed through unchanged.

### Relation types

- `multipolygon` / `boundary` → `Polygon` / `MultiPolygon` (empty member role is treated as `outer`).
- `route` / `waterway` / `multilinestring` → `MultiLineString`.
- Other or unknown relation types produce no relation geometry; their members are emitted as independent features where possible.
- Old-style multipolygons (tags only on the outer way) are attributed to that outer way.
- Unclosed derived `<linestring>` polygons are closed for RFC 7946 compliance.
- Member roles are respected: polygon relations absorb only `outer`/`inner`/empty roles; route `platform` members and stop/admin-centre/label nodes are emitted as independent features.

Beyond plain OSM data the converter understands osmChange diffs, history
extracts and the shapes produced by Overpass `out geom`, `out center`, `out bb`,
`convert`, `make` and `local` (both JSON and XML), including derived
`Point`/`LineString`/`Polygon`/`GeometryCollection` output, member geometries,
`center` fallbacks and `bounds`-only rectangles.


Performance
---

### Why it is fast

The advantage comes from doing less work, not from micro-optimisation. The
larger and more relation-heavy the source, the wider the margin gets.

- **A purpose-built XML scanner.** `src/osm-xml.ts` walks the document once and
  applies each element to the object being built. There is no DOM, no generic
  `$tag`/`$innerNodes` tree and no object allocated per `<nd>` or `<tag>`, which
  is what a general XML parser costs before conversion even starts.
- **References bind once, at the end.** Node, way and relation references are
  deferred and resolved in a single pass per container
  (`src/ref-elements.ts`), so a way's 2 000 node references are one linear
  compaction instead of thousands of O(n²) list removals.
- **One geometry pipeline, not four.** XML, PBF and Overpass JSON all feed the
  same element analyser, so duplicate/history resolution, role handling and ring
  assembly exist once. PBF is decoded straight into elements, with no
  intermediate JSON string and no second pass.
- **Numbers stay numbers.** Coordinates are parsed once into a numeric array
  (`src/way.ts`) rather than joined into keys and parsed again at output time,
  and end-point keys are cached for way stitching.
- **Adjacent-index algorithms where the naive version is quadratic.** Ways are
  stitched through endpoint buckets instead of rescanning candidates, inner rings
  are assigned against a uniform grid over the outer rings instead of every
  outer-inner pair (`src/relation.ts`), relations are flattened iteratively, and
  duplicate resolution allocates one container per *repeated* element rather than
  per element (`src/elements.ts`).
- **No runtime dependencies.** No XML parser, no protobuf runtime, no zlib
  binding: PBF uses a bundled decoder whose bit reader makes one forward pass,
  reuses its Huffman tables across blocks and verifies the Adler-32 trailer.

### Benchmarks

1. Workloads include the boundary XML and JSON of 4 administrative areas (zhucheng, hebei, tokyodo, usa)
2. The benchmark is written with [Vitest's `bench`](https://vitest.dev/guide/features.html#benchmarking), which warms up and then samples each conversion many times, comparing this library against [`osm2geojson-ultra`](https://www.npmjs.com/package/osm2geojson-ultra) (which uses the `txml` parser) and `osmtogeojson` (+ `xmldom` for XML).
```
$ npm run bench
```
3. The # listed in the tables below are coarse lowest speed-up factors (this library vs. the competitor) observed on the sample data.
4. XML and PBF conversion dominate when geometry is built; JSON from Overpass is mostly reference resolution, where the single-pass binding shows the widest margin.

1. XML

|                 | zhucheng | hebei | tokyodo | usa   |
|-----------------|----------|-------|---------|-------|
| vs osmtogeojson | >10.9x   | >18.6x| >15.0x  | >14.9x|
| vs ultra        | >2.6x    | >2.7x | >3.8x   | >4.2x |

2. Overpass JSON

|                 | zhucheng | hebei  | tokyodo | usa   |
|-----------------|----------|--------|---------|-------|
| vs osmtogeojson | >13.2x   | >57.3x | >21.7x  | >27.8x|
| vs ultra        | >4.3x    | >7.4x  | >14.0x  | >21.4x|

> **Note on column values:** the numbers are `hz` ratios reported by Vitest on
> the reference machine (Node 26, Apple silicon). Run `npm run bench` on your
> own hardware to compare.


Correctness
---
`test/index.html` is a browser playground that validates the converted GeoJSON locally with [`geojsonhint`](https://github.com/mapbox/geojsonhint) — no external service or CORS workaround is involved. It still offers copy-to-clipboard if you prefer to inspect the output elsewhere.

Up until now, `osm2geojson-lite` behaves pretty well with all the samples (also quite representative) in the `data` subfolders under `test` and `bench` directories, which also outperforms `osmtogeojson`.

The test suite also runs real data: a Geofabrik PBF extract, osmChange diffs
from the same update stream and history responses from the OSM API, plus a
corpus-wide check that every fixture converts to unique, well-formed features
and that the element path agrees with the direct path. Coverage thresholds are
enforced by `npm test`; see [CONTRIBUTING.md](CONTRIBUTING.md).

From a repository checkout, run:

```sh
npm run valid
```

This builds the package, starts a local static server on port 3000 and opens
`http://localhost:3000/test/index.html`. If the port is busy, use
`PORT=3001 npm run valid`. The dev server disables caching, so you won't see
confusing HTTP 304 responses while editing.

Node.JS version
---
  ES2020 (BigInt is used to decode signed 64-bit PBF fields)
  
Dependencies
---
  - No 3rd party dependency

Contributing
---
See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, benchmarks and the release process. Security reports should follow [SECURITY.md](SECURITY.md).

License
---
MIT

Collaborators
---
* [tibetty](https://github.com/tibetty/)
* [HarelM](https://github.com/HarelM)

