# tiny-osmpbf

A lightweight parsing library for the [osm.pbf](https://wiki.openstreetmap.org/wiki/PBF_Format) format used for OpenStreetMap raw data.
Written in pure javascript. Works in nodejs and the browser.

## Background

Contrary to other osm pbf parsing libraries, tiny-osmpbf isn't purely optimized for speed, but mainly towards ease-of-use and small code footprint (it's less than 16kB minified and gzipped).

This is mainly achived by using two great alternatives to the typical go-to libraries for parsing pbf and decompressing zlib *deflate*d data, namely mapbox's [pbf](https://github.com/mapbox/pbf) library and [tiny-inflate](https://github.com/devongovett/tiny-inflate) (a port of Joergen Ibsen's [tiny inflate](https://bitbucket.org/jibsen/tinf) for C).

The second main difference is the synchronous API, which makes it easier to use the library (e.g. when integrating it into existing synchronous workflows). This comes at the cost of having to load the whole osmpbf input data into memory, so keep that in mind in case you're planning to parse larger files.

## Usage

install via `npm install --save tiny-osmpbf`

Then

```javascript
var tinyosmpbf = require('tiny-osmpbf');

var dataBuffer = … // e.g. from fs.readFileSync(…)

var osmData = tinyosmpbf(dataBuffer);
```

### API

    result = tinyosmpbf(dataBuffer [, handler])

* `dataBuffer` – the pbf data to be parsed
* `handler` – a callback function that is called for each parsed osm element (node, way and relation), optional
* `result` – an object in JSON format containing both the metadata and osm elements from the parsed pbf file (if a custom handler is defined, the osm elements are not included here again)

### Result

The returned data is in the [*OSM-JSON*](https://overpass-api.de/output_formats.html#json) format used by the Overpass API. For example:

```json
{
  "version": 0.6,
  "generator": "Overpass API prototype",
  "osm3s": {
    "timestamp_osm_base": "2016-05-01T00:00:00Z",
    "copyright": "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."
  },
  "elements": [
    {
      "type": "node",
      "id": 251429,
      "lat": 51.0326209,
      "lon": -0.9538873,
      "tags": {},
      "version": 3,
      "timestamp": "2010-10-31T20:48:14Z",
      "changeset": 6246399,
      "uid": 4745,
      "user": "Philip"
    },
    …
    {
      "type": "way",
      "id": 666,
      "nodes": [
        251714,
        …
      ],
      "tags": {
        "designation": "public_bridleway",
        "highway": "path"
      },
      "version": 10,
      "timestamp": "2016-03-20T14:37:06Z",
      "changeset": 37956794,
      "uid": 873940,
      "user": "Mike Baggaley"
    }
  ]
}
```

## See Also

* [osm-pbf-parser](https://github.com/substack/osm-pbf-parser) a streaming parser for osm pbf
* [osm-read](https://github.com/marook/osm-read) a parser that supports both pbf and xml formats
* [node-osmium](https://github.com/osmcode/node-osmium) nodejs bindings for the [libosmium](https://github.com/osmcode/libosmium) C++ library
* [pbf parser comparison](https://github.com/pelias/pbf-parser-comparison) by mapzen
