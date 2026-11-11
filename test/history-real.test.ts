import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson, { toElements } from '../src/index';

/**
 * History fixtures from the OpenStreetMap API (`/api/0.6/{type}/{id}/history`):
 * one node with four versions, one way deleted at its newest version, and one
 * node with 34 versions and unicode tags.
 */

const read = (file: string) => fs.readFileSync(`./test/data/${file}`, 'utf-8');
const opts = { completeFeature: true };

describe('real history extracts', () => {
    it('resolves a node to its newest version', () => {
        const features = (osm2geojson(read('history-node-1690189834.osm'), opts) as any).features;
        expect(features).toHaveLength(1);
        expect(features[0].id).toBe('node/1690189834');
        expect(features[0].properties).toMatchObject({
            version: '4',
            changeset: '188535382',
            user: 'GanKonMalade',
        });
        expect(features[0].geometry.coordinates).toEqual([7.4198951, 43.7380349]);
    });

    it('drops an element whose newest version is deleted', () => {
        const xml = read('history-way-156780344.osm');
        expect((osm2geojson(xml, opts) as any).features).toEqual([]);
        expect(toElements(xml)).toEqual([]);
    });

    it('collapses 34 versions into the current element', () => {
        const xml = read('history-node-6684051501.osm');
        const elements = toElements(xml);
        expect(elements).toHaveLength(1);
        expect(elements[0]).toMatchObject({ type: 'node', id: 6684051501, version: '34' });

        const [feature] = (osm2geojson(xml, opts) as any).features;
        expect(feature.properties).toMatchObject({ name: 'Monaco', 'name:ja': 'モナコ' });
        expect(feature.geometry.coordinates).toEqual([7.4276832, 43.7323492]);
    });

    it('reports the newest version when an older one is asked for', () => {
        // `elementId` resolves after history, so the deleted way is gone and the
        // node answers with its latest state, not the requested version.
        const xml = read('history-way-156780344.osm');
        expect(osm2geojson(xml, { elementId: 'way/156780344' })).toBeUndefined();
        expect((osm2geojson(read('history-node-1690189834.osm'), { elementId: 'node/1690189834' }) as any).properties.version)
            .toBe('4');
    });
});
