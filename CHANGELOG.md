Changelog:
-----
* 2026-11 (2.2.1): Merge duplicate Overpass/OSM elements (JSON and XML) by version and completeness, filling missing tags/geometry and removing orphaned reference binders.
* 2026-11 (2.2.0): Iterative relation flattening, lazy endpoint-bucket stitching, grid-based inner-ring assignment, consistent finite coordinate/bounds validation, documented missing-coordinate gap semantics, hermetic snapshot tests, CDATA handling, exported `IOptions` and removal of the unused generic `XmlParser`. Added corner-case coverage across the XML scanner, relation flattening, multipolygons and validation.
* 2026-11 (2.1.1): Support arbitrary Overpass custom XML element types (#34) and make circular relation traversal cycle-safe, giving closed cycles a root feature instead of an empty result or stack overflow (#36).
* 2026-11: Feature parity with `osm2geojson-ultra` (Overpass derived geometries, `out center`, `out bb`, `elementId`, `tainted`, custom `polygonTags`, canonical polygon rules) plus duplicate-way de-duplication (issue #48), XML entity decoding and a purpose-built OSM XML scanner. Internal rewrites remove the O(n²) binding/merging paths, cache way endpoint keys, share ring scans and keep coordinates numeric, making the converter roughly 2.5–4.2x faster than ultra on the XML reference datasets and 4.4–20x faster on the JSON ones.
* 2025-08: Give more weight to the order of segments when convering a relation to a line, suppot super relations with more than 1 level.
* 2025-05: Support way order in relataion, improve typescript typeings, added CI for vitest tests.
* 2025-03-03: fixed a few bugs around non-*Polygon features processing and convert it to a pure TypeScript project (codes published to [NPM](https://npmjs.org/) have become TSC compiled from now on).
* 2019-2025: quite a few contributors had fixed quite a few bugs and also contributed some good ideas - thanks for their efforts!
* Late 2018: this repository was created and the initial version was pushed to github - almost around specific usages for myself.
