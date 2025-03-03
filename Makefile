ifeq ($(OS),Windows_NT)
    OPEN_CMD = start
    CP_CMD = copy
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        OPEN_CMD = xdg-open
    endif
    ifeq ($(UNAME_S),Darwin)
        OPEN_CMD = open
    endif
    CP_CMD = cp
endif

all: node web

# New target for tests only
test: test-node test-web

node: ts/src/*
	@cd ts && tsc --declaration && $(CP_CMD) src/polytags.json release/ && cd ..

web: ts/release/index.js
	@npx browserify -s osm2geojson ts/release/index.js | npx uglifyjs -c -m -o dist/osm2geojson-lite.js

test-node: test/test.js
	@cd test && node test.js && cd ..

test-web: test/index.html
	@$(OPEN_CMD) test/index.html
