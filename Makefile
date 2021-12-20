osm2geojson-lite.js: lib/index.js package.json
	npx browserify -s osm2geojson lib/index.js | npx uglifyjs -c -m -o dist/osm2geojson-lite.js
