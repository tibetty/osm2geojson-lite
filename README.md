osm2geojson-lite
============

A lightweight (not as lightweight as xml2geojson though) yet faster convertor for [OSM](http://openstreetmap.org) [data](http://wiki.openstreetmap.org/wiki/OSM_XML) whatever in XML or JSON formats to [GeoJSON](http://www.geojson.org/) - much faster (the more complex the data source is, the more performance advantages it posesses) than osmtogeojson in most situations - implemented in pure JavaScript without any 3rd party dependency.

History
-----
An internal function inside [query-geo-boundary](https://www.npmjs.com/package/query-geo-boundary) &rightarrow; stripped out to handle OSM XML only [xml2geojson-lite](https://www.npmjs.com/package/xml2geojson-lite) &rightarrow; this library that supports both OSM XML and OSM/Overpass JSON

Usage
-----

### In Node.JS

Installation:

    $ npm install osm2geojson-lite

Usage:

```js
    const osm2geojson = require('osm2geojson-lite');
    let geojson = osm2geojson(osm);
```

### In Browser
```html
    <script src='your/path/to/osm2geojson-lite.js'></script>
```
```js
    let geojson = osm2geojson(osm);
```

API
---

### `osm2geojson(osm, opts)`

Converts OSM data (XML/JSON) to GeoJSON.

* `osm`: the OSM XML data in String, or OSM/Overpass JSON object
* `opts?`: optional, the options object, right now supports below properties/fields:
    - `completeFeature/allFeatures`:  the default value is `false`. When it's set to `true`, the returned geojson will include all elements that meet the specified conditions in `FeatureCollection` format; otherwise, only the bare geometry of the first `relation` element will be returned.
    - `renderTagged`: the default value is `false`. When it's set to `true`, the returned geojson will include all elements with tags (i.e., tagged) until `suppressWay` changes its behavior a bit; otherwise only the unreferenced ones get returned.
    - `suppressWay/excludeWay`: the default value is `true`. When it's set to `true`, the returned `FeatureCollection` will exclude any referenced ways even though they are tagged; otherwise the features of all tagged `way` will be included, too.


Benchmark
---
### Performance vs. `osmtogeojson` (with `xmldom` for XML processing) 
    * Workloads include the XML and JSON of 4 administrive areas (zhucheng, hebei, tokyodo, usa)
    * Call each conversion for 100 rounds to mitigate the impacts of GC and other factors
    * For each scripts, run as many as times seperately and then calculate the average cost time (in abbr., ACT)
    * The speedup is a coarse lowest number of dividing the ACT of 'osmtogeojson' by the one of this library      
```
$ cd bench
$ node o2gl-bench.js
$ node otg-bench.js

1. XML
-----------------------------------------------------
|  zhucheng  |   hebei    |  tokyodo   |    usa     |
+------------+------------+------------+------------+
|  >2.5x     |  >4.0x     |  >3.0x     |  >3.0x     |
-----------------------------------------------------
2. Overpass JSON
-----------------------------------------------------
|  zhucheng  |   hebei    |  tokyodo   |    usa     |
+------------+------------+------------+------------+
|  >2.5x     |  >11.0x    |  >7.0x     |  >5.0x     |
-----------------------------------------------------
```

Node.JS version
---
  ES5/ES6 features
  
Dependencies
---
  - No 3rd party dependency

License
---
Written in 2018 by tibetty <xihua.duan@gmail.com>
