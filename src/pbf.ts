import { inflate } from './inflate';

/**
 * A minimal OSM PBF (fileformat.proto + osmformat.proto) reader.
 *
 * It decodes the binary container into the same element objects the JSON
 * (Overpass) path already understands, so PBF needs no separate conversion
 * pipeline. Only the protobuf subset OSM PBF uses is implemented: varints,
 * length-delimited fields and packed repeated values. Blobs are inflated by
 * the bundled DEFLATE decoder, which keeps the package dependency-free and
 * the API synchronous in both Node and browsers.
 */

/** A zlib decompressor: `(data, start, end, sizeHint) => bytes`. */
export type Inflate = (data: Uint8Array, start: number, end: number, sizeHint: number) => Uint8Array;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_BYTES = 2;
const WIRE_FIXED32 = 5;

const MEMBER_TYPES = ['node', 'way', 'relation'];

/** Required features this reader implements; anything else is rejected. */
const SUPPORTED_FEATURES = ['OsmSchema-V0.6', 'DenseNodes', 'HistoricalInformation'];

class Reader {
    public pos: number;
    private data: Uint8Array;

    constructor(data: Uint8Array, pos: number = 0) {
        this.data = data;
        this.pos = pos;
    }

    public atEnd(): boolean {
        return this.pos >= this.data.length;
    }

    public varint(): number {
        const data = this.data;
        let pos = this.pos;
        let result = 0;
        let scale = 1;
        for (;;) {
            if (pos >= data.length) {
                throw new Error('truncated PBF varint');
            }
            const byte = data[pos++];
            result += (byte & 0x7f) * scale;
            if ((byte & 0x80) === 0) {
                break;
            }
            scale *= 128;
        }
        this.pos = pos;
        return result;
    }

    public tag(): number {
        return this.varint();
    }

    /**
     * Varint as a signed 64-bit integer. Fields that use this (`way.id`,
     * `relation.id`, `lat_offset`, `lon_offset`) are `int64` rather than
     * `sint64`, so negatives arrive as ten-byte two's complement. The shift is
     * done in BigInt because a 64-bit value does not fit a double exactly.
     */
    public int64(): number {
        const data = this.data;
        let pos = this.pos;
        let result = 0n;
        let shift = 0n;
        for (;;) {
            if (pos >= data.length) {
                throw new Error('truncated PBF varint');
            }
            const byte = data[pos++];
            result |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) {
                break;
            }
            shift += 7n;
        }
        this.pos = pos;
        return Number(BigInt.asIntN(64, result));
    }

    /** A length-delimited field; anything else is a malformed message. */
    public message(tag: number): Uint8Array {
        if ((tag & 7) !== WIRE_BYTES) {
            throw new Error(`unexpected PBF wire type ${tag & 7}`);
        }
        return this.bytes();
    }

    public bytes(): Uint8Array {
        const length = this.varint();
        const start = this.pos;
        const end = start + length;
        if (end > this.data.length) {
            throw new Error('truncated PBF field');
        }
        this.pos = end;
        return this.data.subarray(start, end);
    }

    public skip(wire: number): void {
        switch (wire) {
            case WIRE_VARINT:
                this.varint();
                return;
            case WIRE_FIXED64:
                this.pos += 8;
                return;
            case WIRE_BYTES:
                this.bytes();
                return;
            case WIRE_FIXED32:
                this.pos += 4;
                return;
            default:
                throw new Error(`unsupported PBF wire type ${wire}`);
        }
    }
}

function zigzag(value: number): number {
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function packedVarints(bytes: Uint8Array): number[] {
    const values: number[] = [];
    appendVarints(values, bytes);
    return values;
}

/** Appends instead of spreading, so huge relations cannot overflow the call stack. */
function appendVarints(target: number[], bytes: Uint8Array): void {
    const reader = new Reader(bytes);
    while (!reader.atEnd()) {
        target.push(reader.varint());
    }
}

function decodeUtf8(bytes: Uint8Array): string {
    let text = '';
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++];
        if (first < 0x80) {
            text += String.fromCharCode(first);
            continue;
        }
        let codePoint: number;
        if (first >= 0xf0) {
            codePoint = ((first & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (first >= 0xe0) {
            codePoint = ((first & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
            codePoint = ((first & 0x1f) << 6) | (bytes[i++] & 0x3f);
        }
        if (codePoint > 0xffff) {
            codePoint -= 0x10000;
            text += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
        } else {
            text += String.fromCharCode(codePoint);
        }
    }
    return text;
}

interface BlockContext {
    strings: string[];
    granularity: number;
    latOffset: number;
    lonOffset: number;
    dateGranularity: number;
}

function toCoordinate(context: BlockContext, raw: number, offset: number): number {
    // PBF coordinates are nanodegrees; 1e-7 degrees is 100 nanodegrees.
    const nanoDegrees = offset + context.granularity * raw;
    return Math.round(nanoDegrees / 100) / 1e7;
}

function addTags(target: { tags?: Record<string, string> }, strings: string[], keys: number[], vals: number[]): void {
    if (keys.length === 0) {
        return;
    }
    const tags: Record<string, string> = {};
    for (let i = 0; i < keys.length; i++) {
        tags[strings[keys[i]]] = strings[vals[i]];
    }
    target.tags = tags;
}

function applyInfo(target: any, context: BlockContext, info: { [k: string]: number }): void {
    if (info.version !== undefined) {
        target.version = info.version;
    }
    if (info.timestamp !== undefined) {
        target.timestamp = new Date(info.timestamp * context.dateGranularity).toISOString();
    }
    if (info.changeset !== undefined) {
        target.changeset = info.changeset;
    }
    if (info.uid !== undefined) {
        target.uid = info.uid;
    }
    if (info.user !== undefined) {
        target.user = context.strings[info.user];
    }
    if (info.visible !== undefined) {
        target.visible = info.visible === 1;
    }
}

function parseInfo(bytes: Uint8Array, context: BlockContext): { [k: string]: number } {
    const reader = new Reader(bytes);
    const info: { [k: string]: number } = {};
    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                info.version = reader.varint();
                break;
            case 2:
                info.timestamp = zigzag(reader.varint());
                break;
            case 3:
                info.changeset = zigzag(reader.varint());
                break;
            case 4:
                info.uid = reader.varint();
                break;
            case 5:
                info.user = reader.varint();
                break;
            case 6:
                info.visible = reader.varint();
                break;
            default:
                reader.skip(tag & 7);
        }
    }
    return info;
}

function parseNode(bytes: Uint8Array, context: BlockContext): any {
    const reader = new Reader(bytes);
    const element: any = { type: 'node' };
    const keys: number[] = [];
    const vals: number[] = [];
    let lat = 0;
    let lon = 0;
    let info: { [k: string]: number } | undefined;

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                element.id = zigzag(reader.varint());
                break;
            case 2:
                appendVarints(keys, reader.message(tag));
                break;
            case 3:
                appendVarints(vals, reader.message(tag));
                break;
            case 4:
                info = parseInfo(reader.message(tag), context);
                break;
            case 8:
                lat = zigzag(reader.varint());
                break;
            case 9:
                lon = zigzag(reader.varint());
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    element.lat = toCoordinate(context, lat, context.latOffset);
    element.lon = toCoordinate(context, lon, context.lonOffset);
    addTags(element, context.strings, keys, vals);
    if (info) {
        applyInfo(element, context, info);
    }
    return element;
}

interface DenseInfo {
    version: number[];
    timestamp: number[];
    changeset: number[];
    uid: number[];
    user: number[];
    visible: number[];
}

function parseDenseInfo(bytes: Uint8Array): DenseInfo {
    const reader = new Reader(bytes);
    const info: DenseInfo = { version: [], timestamp: [], changeset: [], uid: [], user: [], visible: [] };
    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        if (field >= 1 && field <= 6) {
            const values = packedVarints(reader.message(tag));
            switch (field) {
                case 1:
                    info.version = values;
                    break;
                case 2:
                    info.timestamp = values.map(zigzag);
                    break;
                case 3:
                    info.changeset = values.map(zigzag);
                    break;
                case 4:
                    info.uid = values.map(zigzag);
                    break;
                case 5:
                    info.user = values.map(zigzag);
                    break;
                default:
                    info.visible = values;
            }
        } else {
            reader.skip(tag & 7);
        }
    }
    return info;
}

function parseDenseNodes(bytes: Uint8Array, context: BlockContext): any[] {
    const reader = new Reader(bytes);
    let ids: number[] = [];
    let lats: number[] = [];
    let lons: number[] = [];
    let keyVals: number[] = [];
    let denseInfo: DenseInfo | undefined;

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                ids = packedVarints(reader.message(tag));
                break;
            case 5:
                denseInfo = parseDenseInfo(reader.message(tag));
                break;
            case 8:
                lats = packedVarints(reader.message(tag));
                break;
            case 9:
                lons = packedVarints(reader.message(tag));
                break;
            case 10:
                keyVals = packedVarints(reader.message(tag));
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    const elements: any[] = [];
    let id = 0;
    let lat = 0;
    let lon = 0;
    let keyPos = 0;
    // DenseInfo arrays are delta coded except `visible`.
    const version = denseInfo ? denseInfo.version : [];
    const timestamp = denseInfo ? denseInfo.timestamp : [];
    const changeset = denseInfo ? denseInfo.changeset : [];
    const uid = denseInfo ? denseInfo.uid : [];
    const user = denseInfo ? denseInfo.user : [];
    const visible = denseInfo ? denseInfo.visible : [];

    for (let i = 0; i < ids.length; i++) {
        id += zigzag(ids[i]);
        lat += zigzag(lats[i] || 0);
        lon += zigzag(lons[i] || 0);

        const element: any = { type: 'node', id };
        element.lat = toCoordinate(context, lat, context.latOffset);
        element.lon = toCoordinate(context, lon, context.lonOffset);

        if (keyVals.length > 0) {
            const keys: number[] = [];
            const vals: number[] = [];
            while (keyPos < keyVals.length && keyVals[keyPos] !== 0) {
                keys.push(keyVals[keyPos++]);
                vals.push(keyVals[keyPos++]);
            }
            keyPos++;
            addTags(element, context.strings, keys, vals);
        }

        if (denseInfo) {
            const info: { [k: string]: number } = {};
            if (i < version.length) {
                version[i] = (i > 0 ? version[i - 1] : 0) + version[i];
                info.version = version[i];
            }
            if (i < timestamp.length) {
                timestamp[i] = (i > 0 ? timestamp[i - 1] : 0) + timestamp[i];
                info.timestamp = timestamp[i];
            }
            if (i < changeset.length) {
                changeset[i] = (i > 0 ? changeset[i - 1] : 0) + changeset[i];
                info.changeset = changeset[i];
            }
            if (i < uid.length) {
                uid[i] = (i > 0 ? uid[i - 1] : 0) + uid[i];
                info.uid = uid[i];
            }
            if (i < user.length) {
                user[i] = (i > 0 ? user[i - 1] : 0) + user[i];
                info.user = user[i];
            }
            if (i < visible.length) {
                info.visible = visible[i];
            }
            applyInfo(element, context, info);
        }

        elements.push(element);
    }
    return elements;
}

function parseWay(bytes: Uint8Array, context: BlockContext): any {
    const reader = new Reader(bytes);
    const element: any = { type: 'way' };
    const keys: number[] = [];
    const vals: number[] = [];
    const refs: number[] = [];
    const lats: number[] = [];
    const lons: number[] = [];
    let info: { [k: string]: number } | undefined;

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                element.id = reader.int64();
                break;
            case 2:
                appendVarints(keys, reader.message(tag));
                break;
            case 3:
                appendVarints(vals, reader.message(tag));
                break;
            case 4:
                info = parseInfo(reader.message(tag), context);
                break;
            case 8:
                appendVarints(refs, reader.message(tag));
                break;
            case 9:
                appendVarints(lats, reader.message(tag));
                break;
            case 10:
                appendVarints(lons, reader.message(tag));
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    addTags(element, context.strings, keys, vals);
    if (info) {
        applyInfo(element, context, info);
    }

    if (lats.length > 0 && lats.length === lons.length) {
        // `LocationsOnWays`: the way carries its own coordinates.
        let lat = 0;
        let lon = 0;
        const geometry: Array<{ lat: number, lon: number }> = [];
        for (let i = 0; i < lats.length; i++) {
            lat += zigzag(lats[i]);
            lon += zigzag(lons[i]);
            geometry.push({ lat: toCoordinate(context, lat, context.latOffset), lon: toCoordinate(context, lon, context.lonOffset) });
        }
        element.geometry = geometry;
    }

    if (refs.length > 0) {
        const nodes: number[] = [];
        let ref = 0;
        for (let i = 0; i < refs.length; i++) {
            ref += zigzag(refs[i]);
            nodes.push(ref);
        }
        element.nodes = nodes;
    }

    return element;
}

function parseRelation(bytes: Uint8Array, context: BlockContext): any {
    const reader = new Reader(bytes);
    const element: any = { type: 'relation' };
    const keys: number[] = [];
    const vals: number[] = [];
    const roles: number[] = [];
    const memids: number[] = [];
    const types: number[] = [];
    let info: { [k: string]: number } | undefined;

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                element.id = reader.int64();
                break;
            case 2:
                appendVarints(keys, reader.message(tag));
                break;
            case 3:
                appendVarints(vals, reader.message(tag));
                break;
            case 4:
                info = parseInfo(reader.message(tag), context);
                break;
            case 8:
                appendVarints(roles, reader.message(tag));
                break;
            case 9:
                appendVarints(memids, reader.message(tag));
                break;
            case 10:
                appendVarints(types, reader.message(tag));
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    addTags(element, context.strings, keys, vals);
    if (info) {
        applyInfo(element, context, info);
    }

    if (memids.length > 0) {
        const members: Array<{ type: string, ref: number, role: string }> = [];
        let ref = 0;
        for (let i = 0; i < memids.length; i++) {
            ref += zigzag(memids[i]);
            const type = MEMBER_TYPES[types[i]];
            if (type === undefined) {
                throw new Error(`unsupported PBF relation member type ${types[i]}`);
            }
            members.push({ type, ref, role: context.strings[roles[i]] || '' });
        }
        element.members = members;
    }

    return element;
}

function parseStringTable(bytes: Uint8Array): string[] {
    const reader = new Reader(bytes);
    const strings: string[] = [];
    while (!reader.atEnd()) {
        const tag = reader.tag();
        if ((tag >>> 3) === 1) {
            strings.push(decodeUtf8(reader.message(tag)));
        } else {
            reader.skip(tag & 7);
        }
    }
    return strings;
}

function parsePrimitiveBlock(bytes: Uint8Array, elements: any[]): void {
    const reader = new Reader(bytes);
    const context: BlockContext = {
        strings: [],
        granularity: 100,
        latOffset: 0,
        lonOffset: 0,
        dateGranularity: 1000,
    };
    const groups: Uint8Array[] = [];

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                context.strings = parseStringTable(reader.message(tag));
                break;
            case 2:
                groups.push(reader.message(tag));
                break;
            case 17:
                context.granularity = reader.varint();
                break;
            case 18:
                context.dateGranularity = reader.varint();
                break;
            case 19:
                context.latOffset = reader.int64();
                break;
            case 20:
                context.lonOffset = reader.int64();
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    for (const group of groups) {
        const groupReader = new Reader(group);
        while (!groupReader.atEnd()) {
            const tag = groupReader.tag();
            const field = tag >>> 3;
            switch (field) {
                case 1:
                    elements.push(parseNode(groupReader.message(tag), context));
                    break;
                case 2:
                    for (const node of parseDenseNodes(groupReader.message(tag), context)) {
                        elements.push(node);
                    }
                    break;
                case 3:
                    elements.push(parseWay(groupReader.message(tag), context));
                    break;
                case 4:
                    elements.push(parseRelation(groupReader.message(tag), context));
                    break;
                default:
                    groupReader.skip(tag & 7);
            }
        }
    }
}

function checkHeaderBlock(bytes: Uint8Array): void {
    const reader = new Reader(bytes);
    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        if (field === 4) {
            const feature = decodeUtf8(reader.message(tag));
            if (SUPPORTED_FEATURES.indexOf(feature) < 0) {
                throw new Error(`unsupported PBF required feature "${feature}"`);
            }
        } else {
            reader.skip(tag & 7);
        }
    }
}

interface BlobHeader {
    type: string;
    datasize: number;
}

function parseBlobHeader(bytes: Uint8Array): BlobHeader {
    const reader = new Reader(bytes);
    const header: BlobHeader = { type: '', datasize: 0 };
    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                header.type = decodeUtf8(reader.message(tag));
                break;
            case 3:
                header.datasize = reader.varint();
                break;
            default:
                reader.skip(tag & 7);
        }
    }
    return header;
}

function readBlob(bytes: Uint8Array, inflateData: Inflate): Uint8Array {
    const reader = new Reader(bytes);
    let rawSize = 0;
    let raw: Uint8Array | undefined;
    let zlibData: Uint8Array | undefined;
    let unsupported = '';

    while (!reader.atEnd()) {
        const tag = reader.tag();
        const field = tag >>> 3;
        switch (field) {
            case 1:
                raw = reader.message(tag);
                break;
            case 2:
                rawSize = reader.varint();
                break;
            case 3:
                zlibData = reader.message(tag);
                break;
            case 4:
                unsupported = 'lzma';
                reader.message(tag);
                break;
            case 5:
                unsupported = 'bzip2';
                reader.message(tag);
                break;
            case 6:
                unsupported = 'lz4';
                reader.message(tag);
                break;
            case 7:
                unsupported = 'zstd';
                reader.message(tag);
                break;
            default:
                reader.skip(tag & 7);
        }
    }

    if (zlibData) {
        return inflateData(zlibData, 0, zlibData.length, rawSize);
    }
    if (raw) {
        return raw;
    }
    throw new Error(unsupported ? `unsupported PBF blob compression "${unsupported}"` : 'empty PBF blob');
}

/**
 * Decode an OSM PBF file into Overpass-shaped elements.
 */
export function parseOsmPbf(data: Uint8Array, inflateData: Inflate = inflate): { elements: any[] } {
    const elements: any[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;

    while (pos < data.length) {
        if (pos + 4 > data.length) {
            throw new Error('truncated PBF blob header');
        }
        const headerLength = view.getInt32(pos);
        pos += 4;
        if (headerLength <= 0 || pos + headerLength > data.length) {
            throw new Error('invalid PBF blob header length');
        }
        const blobHeader = parseBlobHeader(data.subarray(pos, pos + headerLength));
        pos += headerLength;

        if (pos + blobHeader.datasize > data.length) {
            throw new Error('truncated PBF blob');
        }
        const payload = readBlob(data.subarray(pos, pos + blobHeader.datasize), inflateData);
        pos += blobHeader.datasize;

        if (blobHeader.type === 'OSMData') {
            parsePrimitiveBlock(payload, elements);
        } else if (blobHeader.type === 'OSMHeader') {
            checkHeaderBlock(payload);
        }
        // Unknown blob types are skipped, as the format requires.
    }

    return { elements };
}
