osm2geojson-lite.js: lib/index.js package.json
	browserify -s osm2geojson lib/index.js | uglifyjs -c -m -o dist/osm2geojson-lite.js
