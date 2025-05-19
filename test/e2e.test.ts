import fs from 'fs';
import osm2geojson from '../ts/src/index';
import { describe, it, expect } from 'vitest';

describe('osm2geojson', () => {
    let osmFiles = fs.readdirSync('./test/data').filter((file) => file.endsWith('.osm'));
    for (let xmlFile of osmFiles) {
        it('should convert OSM XML to GeoJSON ' + xmlFile, () => {
            let osm = fs.readFileSync(`./test/data/${xmlFile}`, 'utf-8');
            let geojson = osm2geojson(osm, { completeFeature: true });
            const outputFile = `./test/expected/${xmlFile}.geojson`;
            if (!fs.existsSync(outputFile)) {
                fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
            } else {
                let expectedGeojson = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
                expect(geojson).toEqual(expectedGeojson);
            }
        });
    }
    let jsonFiles = fs.readdirSync('./test/data').filter((file) => file.endsWith('.json'));
    for (let jsonFile of jsonFiles) {
        it('should convert OSM JSON to GeoJSON ' + jsonFile, () => {
            let osm = JSON.parse(fs.readFileSync(`./test/data/${jsonFile}`, 'utf-8'));
            let geojson = osm2geojson(osm, { completeFeature: true });
            const outputFile = `./test/expected/${jsonFile}.geojson`;
            if (!fs.existsSync(outputFile)) {
                fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
            } else {
                let expectedGeojson = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
                expect(geojson).toEqual(expectedGeojson);
            }
        });
    }
});