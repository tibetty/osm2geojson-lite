import fs from 'fs';
import osm2geojson from '../ts/src/index';
import { describe, it, expect } from 'vitest';

describe('osm2geojson', () => {
    for (let xmlFile of ['zhucheng.osm', 'hebei.osm', 'tokyodo.osm', 'usa.osm', 'original.osm', 'route.osm']) {
        it('should convert OSM XML to GeoJSON ' + xmlFile, () => {
            let osm = fs.readFileSync(`./test/data/${xmlFile}`, 'utf-8');
            let geojson = osm2geojson(osm, { completeFeature: true });
            let expectedGeojson = JSON.parse(fs.readFileSync(`./test/expected/${xmlFile}.geojson`, 'utf-8'));
            expect(geojson).toEqual(expectedGeojson);
        });
    }

    for (let jsonFile of ['herne.json', 'empty.json', 'node.json', 'way.json', 'relation.json', 'map.json', 'way2.json']) {
        it('should convert OSM JSON to GeoJSON ' + jsonFile, () => {
            let osm = JSON.parse(fs.readFileSync(`./test/data/${jsonFile}`, 'utf-8'));
            let geojson = osm2geojson(osm, { completeFeature: true });
            let expectedGeojson = JSON.parse(fs.readFileSync(`./test/expected/${jsonFile}.geojson`, 'utf-8'));
            expect(geojson).toEqual(expectedGeojson);
        });
    }
});