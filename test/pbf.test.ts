import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import osm2geojson from '../src/index';

/**
 * A tiny hand-rolled PBF encoder so the fixture stays readable and the package
 * keeps zero runtime dependencies. It only writes the fields the reader uses.
 */
class Writer {
    private bytes: number[] = [];

    public varint(value: number): this {
        let rest = value;
        while (rest >= 0x80) {
            this.bytes.push((rest % 0x80) | 0x80);
            rest = Math.floor(rest / 0x80);
        }
        this.bytes.push(rest);
        return this;
    }

    public zigzag(value: number): this {
        return this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
    }

    public tag(field: number, wire: number): this {
        return this.varint((field << 3) | wire);
    }

    public packed(field: number, values: number[], zigzag: boolean): this {
        const inner = new Writer();
        for (const value of values) {
            if (zigzag) {
                inner.zigzag(value);
            } else {
                inner.varint(value);
            }
        }
        return this.bytes_(field, inner.done());
    }

    public string(field: number, value: string): this {
        return this.bytes_(field, new TextEncoder().encode(value));
    }

    public bytes_(field: number, value: Uint8Array): this {
        this.tag(field, 2).varint(value.length);
        for (const byte of value) {
            this.bytes.push(byte);
        }
        return this;
    }

    public done(): Uint8Array {
        return new Uint8Array(this.bytes);
    }
}

const SCALE = 1e7;

function denseInfo(entries: Array<{ version: number, timestamp: number, uid: number, user: string, visible: boolean }>, users: string[]): Writer {
    const writer = new Writer();
    let version = 0;
    let timestamp = 0;
    let uid = 0;
    let user = 0;
    const versionDeltas: number[] = [];
    const timestampDeltas: number[] = [];
    const uidDeltas: number[] = [];
    const userDeltas: number[] = [];
    const visible: number[] = [];
    for (const entry of entries) {
        versionDeltas.push(entry.version - version);
        version = entry.version;
        timestampDeltas.push(entry.timestamp - timestamp);
        timestamp = entry.timestamp;
        uidDeltas.push(entry.uid - uid);
        uid = entry.uid;
        const index = users.indexOf(entry.user);
        userDeltas.push(index - user);
        user = index;
        visible.push(entry.visible ? 1 : 0);
    }
    writer.packed(1, versionDeltas, false);
    writer.packed(2, timestampDeltas, true);
    writer.packed(4, uidDeltas, true);
    writer.packed(5, userDeltas, true);
    writer.packed(6, visible, false);
    return writer;
}

function denseNodes(nodes: Array<{ id: number, lat: number, lon: number, tags?: number[] }>, info?: Writer): Writer {
    const writer = new Writer();
    let id = 0;
    let lat = 0;
    let lon = 0;
    const ids: number[] = [];
    const lats: number[] = [];
    const lons: number[] = [];
    const keyVals: number[] = [];
    for (const node of nodes) {
        ids.push(node.id - id);
        id = node.id;
        const latRaw = Math.round(node.lat * SCALE);
        const lonRaw = Math.round(node.lon * SCALE);
        lats.push(latRaw - lat);
        lat = latRaw;
        lons.push(lonRaw - lon);
        lon = lonRaw;
        keyVals.push(...(node.tags || []), 0);
    }
    writer.packed(1, ids, true);
    if (info) {
        writer.bytes_(5, info.done());
    }
    writer.packed(8, lats, true);
    writer.packed(9, lons, true);
    writer.packed(10, keyVals, false);
    return writer;
}

function way(id: number, refs: number[], keys: number[], vals: number[], version = 1): Writer {
    const writer = new Writer();
    const refDeltas: number[] = [];
    let ref = 0;
    for (const value of refs) {
        refDeltas.push(value - ref);
        ref = value;
    }
    writer.tag(1, 0).varint(id);
    writer.packed(2, keys, false);
    writer.packed(3, vals, false);
    // Info: version 1, timestamp 2020-01-01T00:00:00Z, uid 7, user_sid 2.
    const info = new Writer().tag(1, 0).varint(version).tag(2, 0).zigzag(1577836800).tag(4, 0).varint(7).tag(5, 0).varint(2);
    writer.bytes_(4, info.done());
    writer.packed(8, refDeltas, true);
    return writer;
}

function relation(id: number, members: Array<{ type: number, ref: number, role: number }>): Writer {
    const writer = new Writer();
    const refDeltas: number[] = [];
    let ref = 0;
    for (const member of members) {
        refDeltas.push(member.ref - ref);
        ref = member.ref;
    }
    writer.tag(1, 0).varint(id);
    writer.packed(2, [5, 6], false);
    writer.packed(3, [6, 7], false);
    writer.packed(8, members.map((member) => member.role), false);
    writer.packed(9, refDeltas, true);
    writer.packed(10, members.map((member) => member.type), false);
    return writer;
}

function primitiveBlock(strings: string[], dense: Writer, ways: Writer[], relations: Writer[]): Uint8Array {
    const stringTable = new Writer();
    for (const value of strings) {
        stringTable.string(1, value);
    }
    const group = new Writer();
    group.bytes_(2, dense.done());
    for (const entry of ways) {
        group.bytes_(3, entry.done());
    }
    for (const entry of relations) {
        group.bytes_(4, entry.done());
    }
    const block = new Writer();
    block.bytes_(1, stringTable.done());
    block.bytes_(2, group.done());
    return block.done();
}

function headerBlock(features: string[]): Uint8Array {
    const header = new Writer();
    for (const feature of features) {
        header.string(4, feature);
    }
    return header.done();
}

function blob(payload: Uint8Array, compression: 'zlib' | 'raw' | 'zstd' = 'zlib'): Uint8Array {
    const writer = new Writer();
    if (compression === 'zlib') {
        const compressed = deflateSync(payload);
        writer.tag(2, 0).varint(payload.length);
        writer.bytes_(3, new Uint8Array(compressed));
    } else if (compression === 'raw') {
        writer.bytes_(1, payload);
    } else {
        writer.tag(2, 0).varint(payload.length);
        writer.bytes_(7, new Uint8Array([1, 2, 3]));
    }
    return writer.done();
}

function pbfFile(blobs: Array<{ type: string, payload: Uint8Array, compression?: 'zlib' | 'raw' | 'zstd' }>): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const entry of blobs) {
        const data = blob(entry.payload, entry.compression);
        const header = new Writer().string(1, entry.type).tag(3, 0).varint(data.length).done();
        const length = new Uint8Array(4);
        new DataView(length.buffer).setInt32(0, header.length);
        parts.push(length, header, data);
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const file = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        file.set(part, offset);
        offset += part.length;
    }
    return file;
}

const STRINGS = ['', 'building', 'yes', 'name', 'Square', 'type', 'multipolygon', 'outer', 'alice'];

function sampleFile(compression: 'zlib' | 'raw' = 'zlib'): Uint8Array {
    const nodes = [
        { id: 1, lat: 0, lon: 0, tags: [3, 4] },
        { id: 2, lat: 0, lon: 0.001 },
        { id: 3, lat: 0.001, lon: 0.001 },
        { id: 4, lat: 0.001, lon: 0 },
    ];
    const info = denseInfo(nodes.map((node) => ({
        version: 3, timestamp: 1577836800, uid: 42, user: 'alice', visible: true,
    })), STRINGS);
    const dense = denseNodes(nodes, info);
    const ways = [way(10, [1, 2, 3, 4, 1], [1], [2])];
    const relations = [relation(20, [{ type: 1, ref: 10, role: 7 }])];

    return pbfFile([
        { type: 'OSMHeader', payload: headerBlock(['OsmSchema-V0.6', 'DenseNodes']), compression },
        { type: 'OSMData', payload: primitiveBlock(STRINGS, dense, ways, relations), compression },
    ]);
}

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
