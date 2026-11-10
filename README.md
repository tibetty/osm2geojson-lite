<p align="center"><img src="favicon.png" width="128" alt="osm2geojson-lite icon"></p>

osm2geojson-lite
============

[![NPM Version](https://img.shields.io/npm/v/osm2geojson-lite)](https://www.npmjs.com/package/osm2geojson-lite) [![Codecov](https://img.shields.io/codecov/c/github/tibetty/osm2geojson-lite/main.svg)](https://codecov.io/gh/tibetty/osm2geojson-lite/)


A lightweight (not as lightweight as xml2geojson though) yet faster convertor for [OSM](http://openstreetmap.org) [data](http://wiki.openstreetmap.org/wiki/OSM_XML) whatever in XML or JSON formats to [GeoJSON](http://www.geojson.org/) - much faster (the more complex the data source is, the more performance advantages it posesses) than osmtogeojson in most situations - implemented in pure JavaScript without any 3rd party dependency.

History
-----
An internal function inside [query-geo-boundary](https://www.npmjs.com/package/query-geo-boundary) &rightarrow; stripped out to handle OSM XML only [xml2geojson-lite](https://www.npmjs.com/package/xml2geojson-lite) &rightarrow; this library that supports both OSM XML and OSM/Overpass JSON

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
```

API
---

### `osm2geojson(osm, opts)`

Converts OSM data (XML/JSON) to GeoJSON.

* `osm`: the OSM XML data in String, or OSM/Overpass JSON as object or in String
* `opts?`: optional, the options object, right now supports below properties/fields:
    - `completeFeature`:  the default value is `false`. When it's set to `true`, the returned geojson will include all elements that meet the specified conditions in `FeatureCollection` format; otherwise, only the bare geometry of the first `relation` element will be returned.
    - `renderTagged`: the default value is `false`. When it's set to `true`, the returned geojson will include all elements with tags (i.e., tagged) until `excludeWay` changes its behavior a bit; otherwise only the unreferenced ones get returned.
    - `excludeWay`: the default value is `true`. When it's set to `true`, the returned `FeatureCollection` will exclude all referenced `way`s even though they are tagged; otherwise the features of those `way`s will be included in the resulted result as well.
    - `elementId`: optional, an OSM element id in the form `type/id` (e.g. `way/123`). When set, only that single `Feature` is returned; `undefined` is returned when the element does not exist.
    - `tainted`: the default value is `false`. When set to `true`, features whose referenced nodes/ways/relations are missing (e.g. partial Overpass responses) receive an `@tainted: true` property.
    - `polygonTags`: optional, alternative polygon tag rules for ways. The shape matches the bundled `polytags.json`, e.g. `{ "building": { "ignore": ["no"] } }`; the legacy `whitelist`/`blacklist` spellings are still accepted.

### Coordinate handling

- Missing `null` entries in `out geom` are skipped. The remaining valid points are joined into one line and the feature is marked `@tainted` when the `tainted` option is enabled. This mirrors `osmtogeojson`; it does not split the line at every gap.
- Invalid bounds or center values are ignored rather than emitted as `NaN`.
- A JSON element carrying an explicit GeoJSON `geometry` object is passed through unchanged.

Beyond plain OSM data the converter understands the shapes produced by Overpass
`out geom`, `out center`, `out bb`, `convert`, `make` and `local` (both JSON and
XML), including derived `Point`/`LineString`/`Polygon`/`GeometryCollection`
output, member geometries, `center` fallbacks and `bounds`-only rectangles.


Performance
---
1. Workloads include the boundary XML and JSON of 4 administrive areas (zhucheng, hebei, tokyodo, usa)
2. The benchmark is written with [Vitest's `bench`](https://vitest.dev/guide/features.html#benchmarking), which warms up and then samples each conversion many times, comparing this library against [`osm2geojson-ultra`](https://www.npmjs.com/package/osm2geojson-ultra) (which uses the `txml` parser) and `osmtogeojson` (+ `xmldom` for XML).
```
$ npm run bench
```
3. The # listed in the tables below are coarse lowest speed-up factors (this library vs. the competitor) observed on the sample data.

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
  ES5/ES6 features
  
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

