Changelog:
-----
* 2026-11: Feature parity with `osm2geojson-ultra` (Overpass derived geometries, `out center`, `out bb`, `elementId`, `tainted`, custom `polygonTags`, canonical polygon rules) plus duplicate-way de-duplication (issue #48), XML entity decoding and a purpose-built OSM XML scanner. Internal rewrites remove the O(n²) binding/merging paths, cache way endpoint keys, share ring scans and keep coordinates numeric, making the converter roughly 2.5–4.2x faster than ultra on the XML reference datasets and 4.4–20x faster on the JSON ones.
* 2025-08: Give more weight to the order of segments when convering a relation to a line, suppot super relations with more than 1 level.
* 2025-05: Support way order in relataion, improve typescript typeings, added CI for vitest tests.
* 2025-03-03: fixed a few bugs around non-*Polygon features processing and convert it to a pure TypeScript project (codes published to [NPM](https://npmjs.org/) have become TSC compiled from now on).
* 2019-2025: quite a few contributors had fixed quite a few bugs and also contributed some good ideas - thanks for their efforts!
* Late 2018: this repository was created and the initial version was pushed to github - almost around specific usages for myself.
