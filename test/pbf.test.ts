import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';
import {
    STRINGS, denseInfo, denseNodes, headerBlock, pbfFile, primitiveBlock, sampleFile, way,
} from './pbf-encoder';

const convert = (osm: any, opts?: any) => osm2geojson(osm, { completeFeature: true, renderTagged: true, excludeWay: false, ...opts }) as any;

describe('PBF input', () => {
    it('decodes zlib-compressed nodes, ways and relations', () => {
        const result = convert(sampleFile());
        const byId = (id: string) => result.features.find((f: any) => f.id === id);

        const node = byId('node/1');
        expect(node.geometry).toEqual({ type: 'Point', coordinates: [0, 0] });
        expect(node.properties).toMatchObject({
            id: 'node/1',
            name: 'Square',
            version: 3,
            uid: 42,
            user: 'alice',
            timestamp: '2020-01-01T00:00:00.000Z',
        });

        const way = byId('way/10');
        expect(way.properties).toMatchObject({ id: 'way/10', building: 'yes', version: 1 });
        expect(way.geometry).toEqual({
            type: 'Polygon',
            coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
        });

        const relation = byId('relation/20');
        expect(relation.properties).toMatchObject({ id: 'relation/20', type: 'multipolygon' });
        expect(relation.geometry.type).toBe('Polygon');
    });

    it('decodes uncompressed blobs', () => {
        expect(JSON.stringify(convert(sampleFile('raw')))).toEqual(JSON.stringify(convert(sampleFile())));
    });

    it('accepts an ArrayBuffer and a Uint8Array view', () => {
        const file = sampleFile();
        const padded = new Uint8Array(file.length + 8);
        padded.set(file, 4);
        expect(convert(padded.subarray(4, file.length + 4)).features.length).toBe(3);
        expect(convert(file.slice().buffer).features.length).toBe(3);
    });

    it('skips unknown blob types', () => {
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            { type: 'SomeOtherThing', payload: new Uint8Array([1, 2, 3]) },
            { type: 'OSMData', payload: primitiveBlock(STRINGS, denseNodes([{ id: 1, lat: 1, lon: 2 }]), [], []) },
        ]);
        expect(convert(file).features).toEqual([
            { type: 'Feature', id: 'node/1', properties: { id: 'node/1' }, geometry: { type: 'Point', coordinates: [2, 1] } },
        ]);
    });

    it('rejects unsupported required features and compression', () => {
        const unknownFeature = pbfFile([{ type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'FancyFeature']) }]);
        expect(() => convert(unknownFeature)).toThrow(/unsupported PBF required feature "FancyFeature"/);

        const zstd = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6']), compression: 'zstd' },
        ]);
        expect(() => convert(zstd)).toThrow(/unsupported PBF blob compression "zstd"/);
    });

    it('rejects truncated input', () => {
        const file = sampleFile();
        expect(() => convert(file.subarray(0, 3))).toThrow(/truncated PBF blob header/);
        expect(() => convert(file.subarray(0, file.length - 10))).toThrow(/truncated PBF blob/);
    });
});

describe('PBF history', () => {
    it('drops nodes marked invisible in DenseInfo', () => {
        const nodes = [
            { id: 1, lat: 0, lon: 0 },
            { id: 2, lat: 0, lon: 1 },
            { id: 3, lat: 1, lon: 1 },
        ];
        const info = denseInfo(nodes.map((node, index) => ({
            version: 5, timestamp: 1577836800, uid: 1, user: 'alice', visible: index !== 1,
        })), STRINGS);
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes', 'HistoricalInformation']) },
            { type: 'OSMData', payload: primitiveBlock(STRINGS, denseNodes(nodes, info), [way(10, [1, 2, 3], [1], [2])], []) },
        ]);

        const result = convert(file, { tainted: true });
        expect(result.features.map((f: any) => f.id)).toEqual(['way/10']);
        expect(result.features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
        expect(result.features[0].properties['@tainted']).toBe(true);
    });
});
