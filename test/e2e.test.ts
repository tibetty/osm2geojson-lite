import fs from 'fs';
import osm2geojson from '../src/index';
import { describe, it, expect } from 'vitest';

const updateSnapshots = process.env.UPDATE_SNAPSHOTS === '1';

function checkSnapshot(outputFile: string, geojson: any) {
    if (updateSnapshots) {
        fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));
        return;
    }
    if (!fs.existsSync(outputFile)) {
        throw new Error(`Missing snapshot ${outputFile}. Run: npm run test:update`);
    }
    expect(geojson).toEqual(JSON.parse(fs.readFileSync(outputFile, 'utf-8')));
}

describe('osm2geojson', () => {
    let osmFiles = fs.readdirSync('./test/data').filter((file) => file.endsWith('.osm'));
    for (let xmlFile of osmFiles) {
        it('should convert OSM XML to GeoJSON ' + xmlFile, () => {
            let osm = fs.readFileSync(`./test/data/${xmlFile}`, 'utf-8');
            let geojson = osm2geojson(osm, { completeFeature: true });
            checkSnapshot(`./test/expected/${xmlFile}.geojson`, geojson);
        });
    }
    let jsonFiles = fs.readdirSync('./test/data').filter((file) => file.endsWith('.json'));
    for (let jsonFile of jsonFiles) {
        it('should convert OSM JSON to GeoJSON ' + jsonFile, () => {
            let osm = JSON.parse(fs.readFileSync(`./test/data/${jsonFile}`, 'utf-8'));
            let geojson = osm2geojson(osm, { completeFeature: true });
            checkSnapshot(`./test/expected/${jsonFile}.geojson`, geojson);
        });
    }
});
