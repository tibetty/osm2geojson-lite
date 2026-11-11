import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson, { toElements } from '../src/index';

/**
 * A real Geofabrik extract (Monaco, 707 KB) decoded through the bundled PBF
 * reader. Counts, ids and coordinates are recorded from the committed fixture,
 * so any decoding drift shows up here rather than in a synthetic round-trip.
 */

const pbf = new Uint8Array(fs.readFileSync('./test/data/monaco.osm.pbf'));
const opts = { completeFeature: true, renderTagged: true };

const convert = (extra?: any) => osm2geojson(pbf, { ...opts, ...extra }) as any;

describe('real PBF extract', () => {
    it('decodes every element of the file', () => {
        const elements = toElements(pbf);
        expect(elements).toHaveLength(48472);
        expect(new Set(elements.map((element) => `${element.type}/${element.id}`)).size).toBe(48472);
        expect(elements.filter((element) => element.type === 'node')).toHaveLength(41840);
        expect(elements.filter((element) => element.type === 'way')).toHaveLength(6281);
        expect(elements.filter((element) => element.type === 'relation')).toHaveLength(351);
    });

    it('converts to the expected feature mix', () => {
        const features = convert().features;
        expect(features).toHaveLength(9772);

        const byType: Record<string, number> = {};
        const byGeometry: Record<string, number> = {};
        for (const feature of features) {
            const type = feature.id.split('/')[0];
            byType[type] = (byType[type] || 0) + 1;
            const geometry = feature.geometry ? feature.geometry.type : 'none';
            byGeometry[geometry] = (byGeometry[geometry] || 0) + 1;
        }
        expect(byType).toEqual({ node: 4325, way: 5313, relation: 134 });
        expect(byGeometry).toEqual({
            Point: 4325,
            LineString: 3104,
            Polygon: 2270,
            MultiLineString: 71,
            MultiPolygon: 2,
        });
    });

    it('keeps node tags, metadata and coordinates intact', () => {
        const node = convert().features.find((feature: any) => feature.id === 'node/1790048269');
        expect(node.geometry).toEqual({ type: 'Point', coordinates: [7.4209592, 43.7310164] });
        expect(node.properties).toMatchObject({
            id: 'node/1790048269',
            version: 10326,
            'ISO3166-1:alpha2': 'MC',
            name: 'Monaco',
            capital: 'yes',
        });
    });

    it('builds polygons and multi-geometries from real relations', () => {
        const boundary = convert().features.find((feature: any) => feature.id === 'relation/90352');
        expect(boundary.properties.name).toBe('France - Monaco');
        expect(boundary.geometry.type).toBe('MultiLineString');

        const palace = convert().features.find((feature: any) => feature.id === 'relation/393226');
        expect(palace.properties.name).toBe('Palais princier de Monaco');
        expect(palace.geometry.type).toBe('Polygon');
    });

    it('marks relations whose members are outside the extract as tainted', () => {
        const tainted = convert({ tainted: true }).features.filter((feature: any) => feature.properties['@tainted']);
        expect(tainted).toHaveLength(50);
        expect(tainted.every((feature: any) => feature.id.startsWith('relation/'))).toBe(true);
        expect(convert().features.some((feature: any) => feature.properties['@tainted'])).toBe(false);
    });

    it('does not contain a way that was deleted before the extract', () => {
        const features = convert().features;
        expect(features.some((feature: any) => feature.id === 'way/156780344')).toBe(false);
    });

    it('converts identically when routed through elements', () => {
        const viaElements = osm2geojson({ elements: toElements(pbf) }, { ...opts, tainted: true }) as any;
        expect(viaElements).toEqual(convert({ tainted: true }));
    });

    it('resolves an element by id from the real extract', () => {
        const feature = osm2geojson(pbf, { elementId: 'node/6684051501' }) as any;
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [7.4276832, 43.7323492] });
        expect(feature.properties['name:ja']).toBe('モナコ');
    });
});
