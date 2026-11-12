import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';
import { deflateSync } from 'node:zlib';
import {
    STRINGS, Writer, denseInfo, denseNodes, headerBlock, pbfFile, primitiveBlock, relation, sampleFile, way,
} from './pbf-encoder';
import { toElements } from '../src/index';

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

describe('PBF corner cases', () => {
    it('applies a non-default granularity and block offsets', () => {
        const nodes = [{ id: 1, lat: 0, lon: 0, latRaw: 43123456, lonRaw: 7123456 }];
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            {
                type: 'OSMData',
                payload: primitiveBlock(STRINGS, denseNodes(nodes), [], [], {
                    granularity: 1000, latOffset: 10000, lonOffset: -20000,
                }),
            },
        ]);
        // A positive offset decodes exactly; the negative one is decoded in
        // double precision, so its low bits are approximate (see Reader.int64).
        expect(convert(file).features[0].geometry.coordinates[1]).toBe(43.123466);
        expect(convert(file).features[0].geometry.coordinates[0]).toBeCloseTo(7.123436, 5);
    });

    it('honours a custom date granularity', () => {
        const nodes = [{ id: 1, lat: 0, lon: 0 }];
        const info = denseInfo(nodes.map(() => ({ version: 2, timestamp: 1500, uid: 1, user: 'alice', visible: true })), STRINGS);
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            { type: 'OSMData', payload: primitiveBlock(STRINGS, denseNodes(nodes, info), [], [], { dateGranularity: 100 }) },
        ]);
        expect(convert(file).features[0].properties.timestamp).toBe(new Date(150000).toISOString());
    });

    it('decodes unicode string table entries', () => {
        const strings = ['', 'name', 'モナコ', 'Maréchal-Leclerc'];
        const nodes = [{ id: 1, lat: 0, lon: 0, tags: [1, 2, 1, 3] }];
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            { type: 'OSMData', payload: primitiveBlock(strings, denseNodes(nodes), [], []) },
        ]);
        expect(convert(file).features[0].properties).toMatchObject({ name: 'Maréchal-Leclerc' });
        expect(convert(file).features[0].properties).not.toHaveProperty('タグ');
    });

    it('keeps negative ids from a create before upload', () => {
        const nodes = [{ id: -1, lat: 1, lon: 2 }, { id: -2, lat: 1, lon: 3 }];
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            { type: 'OSMData', payload: primitiveBlock(STRINGS, denseNodes(nodes), [way(-3, [-1, -2], [], [])], []) },
        ]);
        const ids = toElements(file).map((element) => `${element.type}/${element.id}`);
        expect(ids).toContain('node/-1');
        expect(ids).toContain('node/-2');
        expect(ids).toContain('way/-3');
        // The way resolves its negative node references into a line.
        expect(convert(file).features[0].geometry).toEqual({ type: 'LineString', coordinates: [[2, 1], [3, 1]] });
    });

    it('reads LocationsOnWays without node references', () => {
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            {
                type: 'OSMData',
                payload: primitiveBlock(STRINGS, denseNodes([]), [way(11, [1, 2], [1], [2], 1, [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }])], []),
            },
        ]);
        const feature = convert(file).features.find((f: any) => f.id === 'way/11');
        expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
    });

    it('decodes every relation member type', () => {
        const nodes = [{ id: 1, lat: 0, lon: 0 }, { id: 2, lat: 0, lon: 1 }];
        const members = relation(30, [
            { type: 0, ref: 1, role: 1 },
            { type: 1, ref: 10, role: 1 },
            { type: 2, ref: 31, role: 2 },
        ]);
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            {
                type: 'OSMData',
                payload: primitiveBlock(STRINGS, denseNodes(nodes), [way(10, [1, 2], [], [])], [members]),
            },
        ]);
        const element = toElements(file).find((entry) => entry.type === 'relation');
        expect(element.members.map((member: any) => member.type)).toEqual(['node', 'way', 'relation']);
        expect(element.members.map((member: any) => member.ref)).toEqual([1, 10, 31]);
    });

    it('skips the changeset primitive group', () => {
        const file = pbfFile([
            { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']) },
            {
                type: 'OSMData',
                payload: primitiveBlock(STRINGS, denseNodes([{ id: 1, lat: 0, lon: 0 }]), [], [], {
                    changesets: new Writer().tag(1, 0).varint(12345),
                }),
            },
        ]);
        expect(convert(file).features.map((feature: any) => feature.id)).toEqual(['node/1']);
    });

    it('inflates a blob that carries no raw_size', () => {
        const payload = primitiveBlock(STRINGS, denseNodes([{ id: 1, lat: 0, lon: 0 }]), [], []);
        const data = new Writer();
        data.bytes_(3, new Uint8Array(deflateSync(payload)));
        const header = new Writer().string(1, 'OSMData').tag(3, 0).varint(data.done().length).done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, header.length);
        const file = new Uint8Array(length.length + header.length + data.done().length);
        file.set(length, 0);
        file.set(header, 4);
        file.set(data.done(), 4 + header.length);
        expect(convert(file).features.map((feature: any) => feature.id)).toEqual(['node/1']);
    });

    it('ignores an implausible raw_size instead of reserving gigabytes', () => {
        const payload = new Uint8Array(1024);
        const blob = new Writer().tag(2, 0).varint(0x7fffffff).bytes_(3, new Uint8Array(deflateSync(payload)));
        const blobHeader = new Writer().string(1, 'OSMData').tag(3, 0).varint(blob.done().length).done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, blobHeader.length);
        const file = new Uint8Array(4 + blobHeader.length + blob.done().length);
        file.set(length, 0);
        file.set(blobHeader, 4);
        file.set(blob.done(), 4 + blobHeader.length);
        // The hint is capped, so the decode is bounded by the real stream size.
        expect(convert(file).features).toEqual([]);
    });

    it('rejects unsupported protobuf wire types', () => {
        const bad = new Writer().tag(1, 3).done();
        const file = pbfFile([{ type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6']) }, { type: 'OSMData', payload: bad }]);
        expect(() => convert(file)).toThrow(/unexpected PBF wire type 3/);
    });

    it('rejects a truncated varint', () => {
        const file = pbfFile([{ type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6']) }, { type: 'OSMData', payload: new Uint8Array([0x0a, 0x80]) }]);
        expect(() => convert(file)).toThrow(/truncated PBF varint/);
    });
});

describe('PBF container errors', () => {
    const header = () => headerBlock(['OsmSchema-V0.6', 'DenseNodes']);

    it('rejects every unsupported blob compression', () => {
        for (const [field, name] of [[4, 'lzma'], [5, 'bzip2'], [6, 'lz4'], [7, 'zstd']] as const) {
            const data = new Writer().tag(2, 0).varint(8).bytes_(field, new Uint8Array([1, 2, 3]));
            const blobHeader = new Writer().string(1, 'OSMData').tag(3, 0).varint(data.done().length).done();
            const length = new Uint8Array(4);
            new DataView(length.buffer).setInt32(0, blobHeader.length);
            const file = new Uint8Array(4 + blobHeader.length + data.done().length);
            file.set(length, 0);
            file.set(blobHeader, 4);
            file.set(data.done(), 4 + blobHeader.length);
            expect(() => convert(file)).toThrow(new RegExp(`unsupported PBF blob compression "${name}"`));
        }
    });

    it('rejects an empty blob', () => {
        const data = new Writer();
        const blobHeader = new Writer().string(1, 'OSMData').tag(3, 0).varint(0).done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, blobHeader.length);
        const file = new Uint8Array(4 + blobHeader.length);
        file.set(length, 0);
        file.set(blobHeader, 4);
        void data;
        expect(() => convert(file)).toThrow(/empty PBF blob/);
    });

    it('rejects a non-positive blob header length', () => {
        expect(() => convert(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]))).toThrow(/invalid PBF blob header length/);
        expect(() => convert(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/invalid PBF blob header length/);
    });

    it('ignores unknown header and blob header fields', () => {
        const payload = headerBlock(['OsmSchema-V0.6']);
        const blob = new Writer().bytes_(1, payload);
        const blobHeader = new Writer()
            .string(1, 'OSMHeader')
            .bytes_(2, new Uint8Array([9, 9]))
            .tag(3, 0)
            .varint(blob.done().length)
            .done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, blobHeader.length);
        const file = new Uint8Array(4 + blobHeader.length + blob.done().length);
        file.set(length, 0);
        file.set(blobHeader, 4);
        file.set(blob.done(), 4 + blobHeader.length);
        expect(convert(file).features).toEqual([]);
    });

    it('skips unknown info and dense-info fields', () => {
        const info = new Writer()
            .packed(1, [3], false)
            .bytes_(9, new Uint8Array([1]))
            .packed(6, [1], false);
        const file = pbfFile([
            { type: 'OSMHeader', payload: header() },
            { type: 'OSMData', payload: primitiveBlock(STRINGS, denseNodesRawWithInfo(info), [], []) },
        ]);
        expect(convert(file).features[0].properties).toMatchObject({ version: 3 });
    });

    it('decodes a string table with an unknown field', () => {
        const stringTable = new Writer().string(1, '').string(1, 'name').bytes_(7, new Uint8Array([1]));
        const group = new Writer().bytes_(2, denseNodes([{ id: 1, lat: 0, lon: 0, tags: [1, 1] }]).done());
        const block = new Writer().bytes_(1, stringTable.done()).bytes_(2, group.done());
        const file = pbfFile([
            { type: 'OSMHeader', payload: header() },
            { type: 'OSMData', payload: block.done() },
        ]);
        expect(convert(file).features[0].properties.name).toBe('name');
    });
});

/** Dense group whose DenseInfo writer is supplied verbatim. */
function denseNodesRawWithInfo(info: Writer): Writer {
    const writer = new Writer();
    writer.packed(1, [1], true);
    writer.bytes_(5, info.done());
    writer.packed(8, [0], true);
    writer.packed(9, [0], true);
    return writer;
}
