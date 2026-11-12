import type { GeometryObject } from "geojson";
import { Node } from "./node";
import { Output } from "./output";
import { RefElements } from "./ref-elements";
import { Relation } from "./relation";
import { Way } from "./way";
import { decodeEntities } from "./xml-entities";

/**
 * A purpose-built scanner for OpenStreetMap XML.
 *
 * Generic XML parsers build a full `$tag`/`$innerNodes` tree and dispatch
 * events for every element. That is flexible but allocates an object per
 * `<nd>`/`<tag>` and re-scans children in the converters. OSM XML has a small,
 * well-known vocabulary, so this scanner applies the element's effect directly
 * to the `Node`/`Way`/`Relation` being built.
 *
 * Unknown elements are skipped (including their subtree).
 */

const enum Kind {
    Root,
    /** Transparent `<create>`/`<modify>`/`<delete>` wrapper of an `osmChange`. */
    Wrapper,
    Node,
    Way,
    Relation,
    Member,
    LineString,
    Group,
    Custom,
    Skip
}

const enum AttrMode {
    None,
    Bag,
    Nd,
    Tag,
    Member,
    Bounds,
    Center,
    LatLon
}

interface Derived {
    geometry?: GeometryObject;
    lineCoords: number[][];
    geometries: GeometryObject[];
}

interface Frame {
    kind: Kind;
    /** Set on `<delete>` wrappers: their children are deletions, not data. */
    deleted?: boolean;
    id?: string;
    type?: string;
    attrs?: Record<string, string>;
    tags?: Record<string, string>;
    relation?: Relation;
    way?: Way;
    member?: { geometry: { lat: string, lon: string }[], nodes: string[] };
    /** Emit mode: way node references, way coordinates and relation members. */
    nodes?: number[];
    coords?: { lat: string, lon: string }[];
    members?: Array<{ [k: string]: any }>;
    derived?: Derived;
    hasDerived?: boolean;
    derivedInvalid?: boolean;
    lineInvalid?: boolean;
    groupInvalid?: boolean;
    hasNd?: boolean;
    center?: { lat: string, lon: string };
    bounds?: [number, number, number, number];
    lineCoords?: number[][];
    groupPoints?: GeometryObject[];
    groupCoords?: number[][];
}

const LT = 60;
const GT = 62;
const SLASH = 47;
const BANG = 33;
const QUESTION = 63;
const EQUALS = 61;
const DQUOTE = 34;
const SQUOTE = 39;
const SPACE = 32;
const TAB = 9;
const LF = 10;
const CR = 13;

function isSpace(c: number): boolean {
    return c === SPACE || c === TAB || c === LF || c === CR;
}

function newDerived(): Derived {
    return { lineCoords: [], geometries: [] };
}

function buildDerivedGeometry(derived: Derived): GeometryObject | undefined {
    if (derived.lineCoords.length > 0) {
        return { type: 'LineString', coordinates: derived.lineCoords };
    }
    if (derived.geometries.length > 0) {
        return { type: 'GeometryCollection', geometries: derived.geometries };
    }
    return derived.geometry;
}

function addNodeProps(node: Node, attrs: Record<string, string>) {
    for (const k in attrs) {
        if (k !== 'id' && k !== 'lon' && k !== 'lat') {
            node.addProp(k, attrs[k]);
        }
    }
}

function addWayProps(way: Way, attrs: Record<string, string>) {
    for (const k in attrs) {
        if (k !== 'id') {
            way.addProp(k, attrs[k]);
        }
    }
}

function addDerivedProps(output: Output, attrs: Record<string, string>) {
    for (const k in attrs) {
        if (k !== 'id' && k !== 'type') {
            output.addProp(k, attrs[k]);
        }
    }
}

function isRoot(kind: Kind): boolean {
    return kind === Kind.Root || kind === Kind.Wrapper;
}

function toId(value: string): number | string {
    const id = Number(value);
    return Number.isFinite(id) ? id : value;
}

/** Attributes that become element fields in the Overpass JSON shape. */
function addElementAttrs(element: { [k: string]: any }, attrs: Record<string, string>, skipLatLon: boolean) {
    for (const k in attrs) {
        if (k === 'id' || (skipLatLon && (k === 'lat' || k === 'lon'))) {
            continue;
        }
        element[k] = attrs[k];
    }
}

function addElementDerived(element: { [k: string]: any }, frame: Frame) {
    const geometry = buildDerivedGeometry(frame.derived!);
    if (geometry) {
        element.geometry = geometry;
    }
    if (frame.derivedInvalid) {
        element.tainted = true;
    }
}

function boundsElement(bounds: [number, number, number, number]) {
    return { minlat: bounds[1], minlon: bounds[0], maxlat: bounds[3], maxlon: bounds[2] };
}

function finish(frame: Frame, parent: Frame | undefined, refElements: RefElements | undefined, elements: any[] | undefined): void {
    switch (frame.kind) {
        case Kind.Node: {
            const attrs = frame.attrs!;
            if (elements) {
                const element: { [k: string]: any } = { type: 'node', id: toId(frame.id!) };
                addElementAttrs(element, attrs, true);
                if (attrs.lat !== undefined && attrs.lon !== undefined) {
                    element.lat = Number(attrs.lat);
                    element.lon = Number(attrs.lon);
                }
                if (frame.tags) {
                    element.tags = frame.tags;
                }
                if (frame.hasDerived) {
                    addElementDerived(element, frame);
                }
                elements.push(element);
                return;
            }
            if (frame.hasDerived) {
                const output = new Output('node', frame.id!, refElements!);
                addDerivedProps(output, attrs);
                if (frame.tags) {
                    output.addTags(frame.tags);
                }
                const geometry = buildDerivedGeometry(frame.derived!);
                if (geometry) {
                    output.setGeometry(geometry);
                }
                if (frame.derivedInvalid) {
                    output.tainted = true;
                }
            } else {
                const node = new Node(frame.id!, refElements!);
                addNodeProps(node, attrs);
                node.setLatLng({ lat: attrs.lat, lon: attrs.lon });
                if (frame.tags) {
                    node.addTags(frame.tags);
                }
            }
            return;
        }

        case Kind.Way: {
            const way = frame.way;
            if (elements) {
                const element: { [k: string]: any } = { type: 'way', id: toId(frame.id!) };
                addElementAttrs(element, frame.attrs!, false);
                if (frame.tags) {
                    element.tags = frame.tags;
                }
                if (frame.hasDerived) {
                    addElementDerived(element, frame);
                } else {
                    if (frame.nodes && frame.nodes.length > 0) {
                        element.nodes = frame.nodes;
                    }
                    if (frame.coords && frame.coords.length > 0) {
                        element.geometry = frame.coords;
                    }
                    if (frame.center) {
                        element.center = frame.center;
                    }
                    if (frame.bounds && !frame.hasNd) {
                        element.bounds = boundsElement(frame.bounds);
                    }
                }
                elements.push(element);
                return;
            }
            if (frame.hasDerived) {
                const output = new Output('way', frame.id!, refElements!);
                addDerivedProps(output, frame.attrs!);
                if (frame.tags) {
                    output.addTags(frame.tags);
                }
                const geometry = buildDerivedGeometry(frame.derived!);
                if (geometry) {
                    output.setGeometry(geometry);
                }
                if (frame.derivedInvalid) {
                    output.tainted = true;
                }
            } else {
                refElements!.add(way!);
                addWayProps(way!, frame.attrs!);
                if (frame.tags) {
                    way!.addTags(frame.tags);
                }
                if (frame.center) {
                    way!.setCenter(frame.center);
                }
                if (frame.bounds && !frame.hasNd) {
                    way!.setBounds(frame.bounds);
                }
            }
            return;
        }

        case Kind.Relation: {
            const relation = frame.relation;
            if (elements) {
                const element: { [k: string]: any } = { type: 'relation', id: toId(frame.id!) };
                addElementAttrs(element, frame.attrs!, false);
                if (frame.tags) {
                    element.tags = frame.tags;
                }
                if (frame.hasDerived) {
                    addElementDerived(element, frame);
                } else {
                    if (frame.members && frame.members.length > 0) {
                        element.members = frame.members;
                    }
                    if (frame.center) {
                        element.center = frame.center;
                    }
                    if (frame.bounds) {
                        element.bounds = boundsElement(frame.bounds);
                    }
                }
                elements.push(element);
                return;
            }
            if (frame.hasDerived) {
                const output = new Output('relation', frame.id!, refElements!);
                addDerivedProps(output, frame.attrs!);
                if (frame.tags) {
                    output.addTags(frame.tags);
                }
                const geometry = buildDerivedGeometry(frame.derived!);
                if (geometry) {
                    output.setGeometry(geometry);
                }
                if (frame.derivedInvalid) {
                    output.tainted = true;
                }
            } else {
                for (const k in frame.attrs) {
                    if (k !== 'id') {
                        relation!.addProp(k, frame.attrs![k]);
                    }
                }
                if (frame.tags) {
                    relation!.addTags(frame.tags);
                }
                if (frame.center) {
                    relation!.setCenter(frame.center);
                }
            }
            return;
        }

        case Kind.Custom: {
            if (elements) {
                const element: { [k: string]: any } = { type: frame.type!, id: toId(frame.id!) };
                addElementAttrs(element, frame.attrs!, false);
                if (frame.tags) {
                    element.tags = frame.tags;
                }
                addElementDerived(element, frame);
                elements.push(element);
                return;
            }
            const output = new Output(frame.type!, frame.id!, refElements!);
            addDerivedProps(output, frame.attrs!);
            if (frame.tags) {
                output.addTags(frame.tags);
            }
            const geometry = buildDerivedGeometry(frame.derived!);
            if (geometry) {
                output.setGeometry(geometry);
            }
            if (frame.derivedInvalid) {
                output.tainted = true;
            }
            return;
        }

        case Kind.Member: {
            const attrs = frame.attrs!;
            const member: { [k: string]: any } = {
                type: attrs.type,
                role: attrs.role ? attrs.role : '',
                ref: attrs.ref,
            };
            if (attrs.lat && attrs.lon) {
                member.lat = attrs.lat;
                member.lon = attrs.lon;
                member.tags = {};
                for (const k in attrs) {
                    if (k !== 'type' && k !== 'lat' && k !== 'lon') {
                        member[k] = attrs[k];
                    }
                }
            }
            if (frame.member!.geometry.length > 0) {
                member.geometry = frame.member!.geometry;
            } else if (frame.member!.nodes.length > 0) {
                member.nodes = frame.member!.nodes;
            }
            if (parent && parent.kind === Kind.Relation && parent.members) {
                parent.members.push(member);
            } else if (parent && parent.kind === Kind.Relation && parent.relation) {
                parent.relation.addMember(member);
            }
            return;
        }

        case Kind.LineString: {
            if (parent && (parent.kind === Kind.Node || parent.kind === Kind.Way || parent.kind === Kind.Relation || parent.kind === Kind.Custom)) {
                if (frame.lineInvalid) {
                    parent.derivedInvalid = true;
                }
                const ring = frame.lineCoords!;
                if (ring.length > 0) {
                    const first = ring[0];
                    const last = ring[ring.length - 1];
                    if (first[0] !== last[0] || first[1] !== last[1]) {
                        ring.push([first[0], first[1]]);
                    }
                }
                parent.derived!.geometry = {
                    type: 'Polygon',
                    coordinates: [ring],
                };
            }
            return;
        }

        case Kind.Group: {
            if (parent && (parent.kind === Kind.Node || parent.kind === Kind.Way || parent.kind === Kind.Relation || parent.kind === Kind.Custom)) {
                if (frame.groupInvalid) {
                    parent.derivedInvalid = true;
                }
                const derived = parent.derived!;
                const points = frame.groupPoints!;
                for (let i = 0; i < points.length; i++) {
                    derived.geometries.push(points[i]);
                }
                const coords = frame.groupCoords!;
                if (coords.length > 0) {
                    derived.geometries.push({ type: 'LineString', coordinates: coords });
                }
            }
            return;
        }
    }
}

/**
 * Parse OSM/Overpass XML into plain element objects (the Overpass JSON shape).
 *
 * Unlike `parseOsmXml`, which builds `Node`/`Way`/`Relation` objects for
 * immediate conversion, this keeps the document as data so it can be merged
 * with another document and converted later.
 */
export function parseOsmXmlElements(xml: string): any[] {
    const elements: any[] = [];
    scan(xml, undefined, elements);
    return elements;
}

/**
 * Parse OSM/Overpass XML directly into `RefElements`.
 */
export function parseOsmXml(xml: string, refElements: RefElements): void {
    scan(xml, refElements, undefined);
}

function scan(xml: string, refElements: RefElements | undefined, elements: any[] | undefined): void {
    const len = xml.length;
    const stack: Frame[] = [];
    let i = 0;

    while (i < len) {
        const lt = xml.indexOf('<', i);
        if (lt < 0) {
            break;
        }
        i = lt + 1;
        const c = xml.charCodeAt(i);

        if (c === SLASH) {
            const gt = xml.indexOf('>', i);
            if (gt < 0) {
                break;
            }
            i = gt + 1;
            const frame = stack.pop();
            if (frame) {
                finish(frame, stack.length ? stack[stack.length - 1] : undefined, refElements, elements);
            }
            continue;
        }

        if (c === QUESTION) {
            const gt = xml.indexOf('>', i);
            i = gt < 0 ? len : gt + 1;
            continue;
        }

        if (c === BANG) {
            if (xml.charCodeAt(i + 1) === 45 && xml.charCodeAt(i + 2) === 45) {
                const end = xml.indexOf('-->', i + 3);
                i = end < 0 ? len : end + 3;
            } else if (xml.startsWith('![CDATA[', i)) {
                const end = xml.indexOf(']]>', i + 8);
                i = end < 0 ? len : end + 3;
            } else {
                const gt = xml.indexOf('>', i);
                i = gt < 0 ? len : gt + 1;
            }
            continue;
        }

        let j = i;
        while (j < len) {
            const ch = xml.charCodeAt(j);
            if (isSpace(ch) || ch === SLASH || ch === GT) {
                break;
            }
            j++;
        }
        const tag = xml.slice(i, j);
        const topKind = stack.length ? stack[stack.length - 1].kind : Kind.Root;

        let kind: Kind = Kind.Skip;
        let attrMode: AttrMode = AttrMode.None;
        switch (tag) {
            case 'node':
                if (isRoot(topKind)) {
                    kind = Kind.Node;
                    attrMode = AttrMode.Bag;
                }
                break;
            case 'way':
                if (isRoot(topKind)) {
                    kind = Kind.Way;
                    attrMode = AttrMode.Bag;
                }
                break;
            case 'relation':
                if (isRoot(topKind)) {
                    kind = Kind.Relation;
                    attrMode = AttrMode.Bag;
                }
                break;
            case 'osm':
            case 'osmChange':
                kind = Kind.Root;
                break;
            case 'create':
            case 'modify':
            case 'delete':
                // osmChange sections are transparent: their children are
                // ordinary node/way/relation elements at the document root.
                if (topKind === Kind.Root) {
                    kind = Kind.Wrapper;
                }
                break;
            case 'member':
                if (topKind === Kind.Relation) {
                    kind = Kind.Member;
                    attrMode = AttrMode.Member;
                }
                break;
            case 'nd':
                if (topKind === Kind.Way || topKind === Kind.Member) {
                    attrMode = AttrMode.Nd;
                }
                break;
            case 'tag':
                if (topKind === Kind.Node || topKind === Kind.Way || topKind === Kind.Relation || topKind === Kind.Custom) {
                    attrMode = AttrMode.Tag;
                }
                break;
            case 'bounds':
                if (topKind === Kind.Relation || topKind === Kind.Way) {
                    attrMode = AttrMode.Bounds;
                }
                break;
            case 'center':
                if (topKind === Kind.Way || topKind === Kind.Relation) {
                    attrMode = AttrMode.Center;
                }
                break;
            case 'point':
                if (topKind === Kind.Node || topKind === Kind.Way || topKind === Kind.Relation || topKind === Kind.Group || topKind === Kind.Custom) {
                    attrMode = AttrMode.LatLon;
                }
                break;
            case 'vertex':
                if (topKind === Kind.Way || topKind === Kind.Relation || topKind === Kind.Group || topKind === Kind.LineString || topKind === Kind.Custom) {
                    attrMode = AttrMode.LatLon;
                }
                break;
            case 'linestring':
                if (topKind === Kind.Node || topKind === Kind.Way || topKind === Kind.Relation || topKind === Kind.Custom) {
                    kind = Kind.LineString;
                }
                break;
            case 'group':
                if (topKind === Kind.Node || topKind === Kind.Way || topKind === Kind.Relation || topKind === Kind.Custom) {
                    kind = Kind.Group;
                }
                break;
            default:
                // Unknown top-level elements are treated as Overpass custom
                // derived objects once they show an `id` attribute.
                if (isRoot(topKind)) {
                    attrMode = AttrMode.Bag;
                }
                break;
        }

        const attrs: Record<string, string> | undefined =
            attrMode === AttrMode.Bag || attrMode === AttrMode.Member ? {} : undefined;
        let ref = '', lat = '', lon = '', k = '', v = '';
        let minlat = '', minlon = '', maxlat = '', maxlon = '';
        let selfClose = false;

        while (j < len) {
            let ch = xml.charCodeAt(j);
            while (isSpace(ch)) {
                ch = xml.charCodeAt(++j);
            }
            if (ch === GT) {
                j++;
                break;
            }
            if (ch === SLASH) {
                selfClose = true;
                j++;
                continue;
            }

            const nameStart = j;
            while (j < len) {
                ch = xml.charCodeAt(j);
                if (ch === EQUALS || isSpace(ch) || ch === GT || ch === SLASH) {
                    break;
                }
                j++;
            }
            const attrName = xml.slice(nameStart, j);

            while (isSpace(xml.charCodeAt(j))) {
                j++;
            }
            let value = '';
            if (xml.charCodeAt(j) === EQUALS) {
                j++;
                while (isSpace(xml.charCodeAt(j))) {
                    j++;
                }
                const q = xml.charCodeAt(j);
                if (q === DQUOTE || q === SQUOTE) {
                    j++;
                    let valEnd = xml.indexOf(q === DQUOTE ? '"' : "'", j);
                    if (valEnd < 0) {
                        valEnd = len;
                    }
                    value = xml.slice(j, valEnd);
                    if (value.indexOf('&') >= 0) {
                        value = decodeEntities(value);
                    }
                    j = valEnd + 1;
                }
            }

            switch (attrMode) {
                case AttrMode.Bag:
                case AttrMode.Member:
                    attrs![attrName] = value;
                    break;
                case AttrMode.Nd:
                    if (attrName === 'ref') {
                        ref = value;
                    } else if (attrName === 'lat') {
                        lat = value;
                    } else if (attrName === 'lon') {
                        lon = value;
                    }
                    break;
                case AttrMode.Tag:
                    if (attrName === 'k') {
                        k = value;
                    } else if (attrName === 'v') {
                        v = value;
                    }
                    break;
                case AttrMode.Bounds:
                    if (attrName === 'minlat') {
                        minlat = value;
                    } else if (attrName === 'minlon') {
                        minlon = value;
                    } else if (attrName === 'maxlat') {
                        maxlat = value;
                    } else if (attrName === 'maxlon') {
                        maxlon = value;
                    }
                    break;
                case AttrMode.Center:
                case AttrMode.LatLon:
                    if (attrName === 'lat') {
                        lat = value;
                    } else if (attrName === 'lon') {
                        lon = value;
                    }
                    break;
            }
        }
        i = j;

        const parent = stack.length ? stack[stack.length - 1] : undefined;
        const inDelete = parent !== undefined && parent.deleted === true;

        // `visible=false` (history extracts), `action="delete"` and the
        // `<delete>` section of an osmChange all mean the element is gone.
        const discarded = attrMode === AttrMode.Bag && attrs !== undefined &&
            (attrs.visible === 'false' || attrs.action === 'delete' || inDelete);
        if ((kind === Kind.Node || kind === Kind.Way || kind === Kind.Relation) && discarded) {
            if (refElements) {
                // Remember the deletion so a surviving older version is dropped
                // when references are bound.
                if (attrs && attrs.id) {
                    refElements.markDeleted(`${tag}/${attrs.id}`, Number(attrs.version) || 0);
                }
                kind = Kind.Skip;
            } else if (attrs) {
                // Element mode keeps the entry: deletion is data for the merge.
                attrs.action = 'delete';
            }
        }
        if (kind === Kind.Skip && attrMode === AttrMode.Bag && attrs && attrs.id && !discarded) {
            kind = Kind.Custom;
        }

        if (attrMode === AttrMode.Nd) {
            if (parent) {
                if (parent.kind === Kind.Way) {
                    parent.hasNd = true;
                    if (parent.way) {
                        if (lat && lon) {
                            parent.way.addLatLng({ lat, lon });
                        } else if (ref) {
                            parent.way.addNodeRef(ref);
                        }
                    } else if (lat && lon) {
                        parent.coords!.push({ lat, lon });
                    } else if (ref) {
                        parent.nodes!.push(Number(ref));
                    }
                } else if (parent.kind === Kind.Member && parent.member) {
                    if (lat && lon) {
                        parent.member.geometry.push({ lat, lon });
                    } else if (ref) {
                        parent.member.nodes.push(ref);
                    }
                }
            }
            if (!selfClose) {
                stack.push({ kind: Kind.Skip });
            }
            continue;
        }

        if (attrMode === AttrMode.Tag) {
            if (parent && k) {
                const tags = parent.tags || (parent.tags = {});
                tags[k] = v;
            }
            if (!selfClose) {
                stack.push({ kind: Kind.Skip });
            }
            continue;
        }

        if (attrMode === AttrMode.Bounds) {
            if (parent) {
                const bounds: [number, number, number, number] = [
                    parseFloat(minlon), parseFloat(minlat), parseFloat(maxlon), parseFloat(maxlat),
                ];
                if (parent.kind === Kind.Relation && parent.relation) {
                    parent.relation.setBounds(bounds);
                } else if (parent.kind === Kind.Way || parent.kind === Kind.Relation) {
                    parent.bounds = bounds;
                }
            }
            if (!selfClose) {
                stack.push({ kind: Kind.Skip });
            }
            continue;
        }

        if (attrMode === AttrMode.Center) {
            if (parent) {
                parent.center = { lat, lon };
            }
            if (!selfClose) {
                stack.push({ kind: Kind.Skip });
            }
            continue;
        }

        if (attrMode === AttrMode.LatLon) {
            if (parent) {
                const x = +lon;
                const y = +lat;
                if (lat === '' || lon === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
                    switch (parent.kind) {
                        case Kind.Node:
                        case Kind.Way:
                        case Kind.Relation:
                        case Kind.Custom:
                            parent.derivedInvalid = true;
                            break;
                        case Kind.Group:
                            parent.groupInvalid = true;
                            break;
                        case Kind.LineString:
                            parent.lineInvalid = true;
                            break;
                    }
                } else {
                    switch (parent.kind) {
                        case Kind.Node:
                        case Kind.Way:
                        case Kind.Relation:
                        case Kind.Custom:
                            parent.hasDerived = true;
                            if (tag === 'point') {
                                parent.derived!.geometry = { type: 'Point', coordinates: [x, y] };
                            } else {
                                parent.derived!.lineCoords.push([x, y]);
                            }
                            break;
                        case Kind.Group:
                            if (tag === 'point') {
                                parent.groupPoints!.push({ type: 'Point', coordinates: [x, y] });
                            } else {
                                parent.groupCoords!.push([x, y]);
                            }
                            break;
                        case Kind.LineString:
                            parent.lineCoords!.push([x, y]);
                            break;
                    }
                }
            }
            if (!selfClose) {
                stack.push({ kind: Kind.Skip });
            }
            continue;
        }

        let frame: Frame | undefined;
        switch (kind) {
            case Kind.Node:
                frame = {
                    kind,
                    id: attrs!.id,
                    attrs,
                    derived: newDerived(),
                    hasDerived: false,
                };
                break;
            case Kind.Way:
                frame = {
                    kind,
                    id: attrs!.id,
                    attrs,
                    way: refElements ? new Way(attrs!.id, refElements, false) : undefined,
                    derived: newDerived(),
                    hasDerived: false,
                    nodes: refElements ? undefined : [],
                    coords: refElements ? undefined : [],
                };
                break;
            case Kind.Relation:
                frame = {
                    kind,
                    id: attrs!.id,
                    attrs,
                    relation: refElements ? new Relation(attrs!.id, refElements) : undefined,
                    derived: newDerived(),
                    hasDerived: false,
                    members: refElements ? undefined : [],
                };
                break;
            case Kind.Member:
                frame = {
                    kind,
                    attrs,
                    member: { geometry: [], nodes: [] },
                };
                break;
            case Kind.Custom:
                frame = {
                    kind,
                    id: attrs!.id,
                    type: tag,
                    attrs,
                    derived: newDerived(),
                    hasDerived: false,
                };
                break;
            case Kind.LineString:
                if (parent && (parent.kind === Kind.Node || parent.kind === Kind.Way || parent.kind === Kind.Relation || parent.kind === Kind.Custom)) {
                    parent.hasDerived = true;
                }
                frame = { kind, lineCoords: [] };
                break;
            case Kind.Group:
                if (parent && (parent.kind === Kind.Node || parent.kind === Kind.Way || parent.kind === Kind.Relation || parent.kind === Kind.Custom)) {
                    parent.hasDerived = true;
                }
                frame = { kind, groupPoints: [], groupCoords: [] };
                break;
            case Kind.Root:
            case Kind.Skip:
                frame = { kind };
                break;
            case Kind.Wrapper:
                frame = { kind, deleted: tag === 'delete' };
                break;
        }

        if (selfClose) {
            if (frame) {
                finish(frame, parent, refElements, elements);
            }
        } else if (frame) {
            stack.push(frame);
        }
    }
}
