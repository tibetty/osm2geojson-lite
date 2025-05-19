WEB_TARGET_DIR = dist/web

ifeq ($(OS),Windows_NT)
    MKDIR_CMD = if not exist $(TARGET_DIR) mkdir $(subst /,\,$(WEB_TARGET_DIR))
    OPEN_CMD = start
    CP_CMD = copy
    
else
    MKDIR_CMD = mkdir -p $(WEB_TARGET_DIR)
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        OPEN_CMD = xdg-open
    endif
    ifeq ($(UNAME_S),Darwin)
        OPEN_CMD = open
    endif
    CP_CMD = cp
endif

all: node create_web_dir web

# New target for tests only
test: test-node test-web

node: ts/src/*
	@cd ts && tsc --declaration && $(CP_CMD) src/polytags.json ../dist/node && cd ..

create_web_dir:
	@$(MKDIR_CMD)

web: dist/node/index.js
	@npx browserify -s osm2geojson dist/node/index.js | npx uglifyjs -c -m -o dist/web/osm2geojson-lite.js

test-node: test/e2e.test.ts
	@npm run test

test-web: test/index.html
	@$(OPEN_CMD) test/index.html