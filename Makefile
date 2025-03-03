ifeq ($(OS),Windows_NT)
    OPEN_INDEX_HTML = start ./index.html
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        OPEN_INDEX_HTML = xdg-open ./index.html
    endif
    ifeq ($(UNAME_S),Darwin)
        OPEN_INDEX_HTML = open ./index.html
    endif
endif

all: node web test-node test-web

node: ts/src/*
	cd ts && tsc && cp src/polytags.json release/ && cd ..

web: ts/release/*
	npx browserify -s osm2geojson ts/release/index.js | npx uglifyjs -c -m -o dist/osm2geojson-lite.js

test-node: test/test.js
	cd test && node test.js && cd ..

test-web:
	$(OPEN_INDEX_HTML)
