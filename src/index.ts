import { purgeProps } from './utils';
import { XmlParser } from './xmlparser';
import { LatLon, Node } from './node';
import { Way } from './way';
import type { PolygonTags } from './way';
import { Relation } from './relation';
import { Output } from './output';
import { RefElements } from './ref-elements';
import type { Feature, FeatureCollection, GeometryObject } from 'geojson';

interface IOptions {
    /**
     * When it's set to `true`, the returned geojson will include all elements that meet the specified conditions in `FeatureCollection` format; 
     * otherwise, only the bare geometry of the first `relation` element will be returned.
     * @default false
     */
    completeFeature?: boolean;
    /**
     * When it's set to `true`, the returned geojson will include all elements with tags (i.e., tagged) 
     * until `suppressWay` changes its behavior a bit; otherwise only the unreferenced ones get returned.
     * @default false
     */
    renderTagged?: boolean;
    /**
     * When it's set to `true`, the returned `FeatureCollection` will exclude all referenced `way`s even though they are tagged; 
     * otherwise the features of those `way`s will be included in the resulted result as well.
     * @default true
     */
    excludeWay?: boolean;
    /**
     * An OSM element ID in the form of `type/id`, e.g. `way/123`. When set, only that
     * feature is returned instead of a `FeatureCollection`.
     * @default undefined
     */
    elementId?: string;
    /**
     * When set to `true`, features that reference missing nodes/ways/relations
     * receive an `@tainted: true` property. Matches `osm2geojson-ultra`.
     * @default false
     */
    tainted?: boolean;
    /**
     * Alternate polygon tag rules for ways. The shape matches `polytags.json`:
     * `{ key: { ignore?, include?, exclude? } }`. Legacy `whitelist` /
     * `blacklist` spellings are also accepted.
     * @default undefined (built-in rules)
     */
    polygonTags?: PolygonTags;
}

function parseOptions(options: IOptions | undefined): { completeFeature: boolean; renderTagged: boolean; excludeWay: boolean; elementId: string | undefined; tainted: boolean; polygonTags: PolygonTags | undefined } {
    if (!options) {
        return { completeFeature: false, renderTagged: false, excludeWay: true, elementId: undefined, tainted: false, polygonTags: undefined };
    }
    let excludeWay = options.excludeWay === undefined || options.excludeWay;
    let completeFeature = options.completeFeature ? true : false;
    let renderTagged = options.renderTagged ? true : false;
    let tainted = options.tainted ? true : false;
    return { completeFeature, renderTagged, excludeWay, elementId: options.elementId, tainted, polygonTags: options.polygonTags };
}

function detectFormat(o: string | { [k: string]: any }): "json" | "xml" | "json-raw" | "invalid" {
    if (o && typeof o === 'object' && (o as { [k: string]: any }).elements) {
        return 'json';
    }
    if (typeof o === 'string') {
        if (o.indexOf('<osm') >= 0) {
            return 'xml';
        }
        if (o.trim().startsWith('{')) {
            return 'json-raw';
        }
    }
    return 'invalid';
};

function analyzeFeaturesFromJson(osm: { [k: string]: any }, refElements: RefElements): void {
    for (const elem of (osm as { [k: string]: any }).elements) {
        // Overpass derived geometries (`local`, `convert`, `make`, `out geom`)
        // may already carry a complete GeoJSON geometry object.
        if (elem.geometry && typeof elem.geometry === 'object' && elem.geometry.type) {
            const output = new Output(elem.type, elem.id, refElements);
            if (elem.tags) {
                output.addTags(elem.tags);
            }
            output.addProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'geometry']));
            output.setGeometry(elem.geometry);
            continue;
        }

        switch (elem.type) {
            case 'node':
                const node = new Node(elem.id as string, refElements);
                if (elem.tags) {
                    node.addTags(elem.tags);
                }
                node.addProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'lat', 'lon']));
                node.setLatLng(elem);
                break;
            case 'way':
                const way = new Way(elem.id as string, refElements);
                if (elem.tags) {
                    way.addTags(elem.tags);
                }
                way.addProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'nodes', 'geometry']));
                if (elem.geometry) {
                    way.setLatLngArray(elem.geometry);
                } else if (elem.center) {
                    way.setCenter(elem.center);
                } else if (elem.nodes) {
                    for (const n of elem.nodes) {
                        way.addNodeRef(n);
                    }
                }
                break;
            case 'relation':
                const relation = new Relation(elem.id as string, refElements);
                if (elem.bounds) {
                    relation.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
                }
                if (elem.tags) {
                    relation.addTags(elem.tags);
                }
                if (elem.center) {
                    relation.setCenter(elem.center);
                }
                relation.addProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'bounds', 'members']));
                if (elem.members) {
                    for (const member of elem.members) {
                        relation.addMember(member);
                    }
                }
            default:
                break;
        }
    }
}

function hasDerivedGeometry(node: { [k: string]: any }): boolean {
    const innerNodes = node.$innerNodes;
    if (!innerNodes) {
        return false;
    }
    for (const child of innerNodes) {
        const tag = child.$tag;
        if (tag === 'point' || tag === 'vertex' || tag === 'linestring' || tag === 'group') {
            return true;
        }
    }
    return false;
}

function buildDerivedGeometry(innerNodes: { [k: string]: any }[]): GeometryObject | undefined {
    let geometry: GeometryObject | undefined;
    const lineCoords: number[][] = [];
    const geometries: GeometryObject[] = [];

    for (const child of innerNodes) {
        switch (child.$tag) {
            case 'point':
                geometry = { type: 'Point', coordinates: [+child.lon, +child.lat] };
                break;
            case 'vertex':
                lineCoords.push([+child.lon, +child.lat]);
                break;
            case 'linestring': {
                const ring: number[][] = [];
                for (const vertex of child.$innerNodes || []) {
                    if (vertex.$tag === 'vertex') {
                        ring.push([+vertex.lon, +vertex.lat]);
                    }
                }
                geometry = { type: 'Polygon', coordinates: [ring] };
                break;
            }
            case 'group': {
                const groupCoords: number[][] = [];
                for (const groupChild of child.$innerNodes || []) {
                    if (groupChild.$tag === 'point') {
                        geometries.push({ type: 'Point', coordinates: [+groupChild.lon, +groupChild.lat] });
                    } else if (groupChild.$tag === 'vertex') {
                        groupCoords.push([+groupChild.lon, +groupChild.lat]);
                    }
                }
                if (groupCoords.length > 0) {
                    geometries.push({ type: 'LineString', coordinates: groupCoords });
                }
                break;
            }
        }
    }

    if (lineCoords.length > 0) {
        return { type: 'LineString', coordinates: lineCoords };
    }
    if (geometries.length > 0) {
        return { type: 'GeometryCollection', geometries };
    }
    return geometry;
}

function addDerivedFromXml(type: string, node: { [k: string]: any }, refElements: RefElements): void {
    const output = new Output(type, node.id, refElements);
    for (const k in node) {
        if (k[0] !== '$' && k !== 'id' && k !== 'type') {
            output.addProp(k, node[k]);
        }
    }
    for (const ind of node.$innerNodes || []) {
        if (ind.$tag === 'tag') {
            output.addTag(ind.k, ind.v);
        }
    }
    const geometry = buildDerivedGeometry(node.$innerNodes || []);
    if (geometry) {
        output.setGeometry(geometry);
    }
}

function analyzeFeaturesFromXml(osm: string, refElements: RefElements): void {
    const xmlParser = new XmlParser({ progressive: true });

    xmlParser.on('</osm.node>', (node: { [k: string]: any }) => {
        if (hasDerivedGeometry(node)) {
            addDerivedFromXml('node', node, refElements);
            return;
        }
        const nd = new Node(node.id, refElements);
        for (const k in node) {
            if (k[0] !== '$' && k !== 'id' && k !== 'lon' && k !== 'lat') {
                nd.addProp(k, node[k]);
            }
        }
        nd.setLatLng(node as LatLon);
        if (node.$innerNodes) {
            for (const ind of node.$innerNodes) {
                if (ind.$tag === 'tag') {
                    nd.addTag(ind.k, ind.v);
                }
            }
        }
    });

    xmlParser.on('</osm.way>', (node: { [k: string]: any }) => {
        if (hasDerivedGeometry(node)) {
            addDerivedFromXml('way', node, refElements);
            return;
        }
        const way = new Way(node.id, refElements);
        for (const k in node) {
            if (k[0] !== '$' && k !== 'id') {
                way.addProp(k, node[k]);
            }
        }
        if (node.$innerNodes) {
            for (const ind of node.$innerNodes) {
                if (ind.$tag === 'nd') {
                    if (ind.lon && ind.lat) {
                        way.addLatLng(ind);
                    } else if (ind.ref) {
                        way.addNodeRef(ind.ref);
                    }
                } else if (ind.$tag === 'tag') {
                    way.addTag(ind.k, ind.v);
                } else if (ind.$tag === 'center') {
                    way.setCenter(ind);
                }
            }
        }
    });

    xmlParser.on('<osm.relation>', (node: { [k: string]: any }) => new Relation(node.id, refElements));

    xmlParser.on('</osm.relation.member>', (node: { [k: string]: any }, parent?: { [k: string]: any }) => {
        const relation = refElements.get(`relation/${parent?.id}`) as Relation;
        const member: { [k: string]: any } = {
            type: node.type,
            role: node.role ? node.role : '',
            ref: node.ref,
        };

        if (node.lat && node.lon) {
            member.lat = node.lat, member.lon = node.lon, member.tags = {};
            for (const k in node) {
                if (k[0] !== '$' && k !== 'type' && k !== 'lat' && k !== 'lon') {
                    member[k] = node[k];
                }
            }
        }

        if (node.$innerNodes) {
            const geometry: any[] = [];
            const nodes: any[] = [];
            for (const ind of node.$innerNodes) {
                if (ind.lat && ind.lon) {
                    geometry.push(ind);
                } else if (ind.ref) {
                    nodes.push(ind.ref);
                }
            }
            if (geometry.length > 0) {
                member.geometry = geometry;
            } else if (nodes.length > 0) {
                member.nodes = nodes;
            }
        }
        relation.addMember(member);
    });

    xmlParser.on('</osm.relation.bounds>', (node: { [k: string]: any }, parent?: { [k: string]: any }) => {
        (refElements.get(`relation/${parent?.id}`) as Relation).setBounds([parseFloat(node.minlon), parseFloat(node.minlat), parseFloat(node.maxlon), parseFloat(node.maxlat)]);
    });

    xmlParser.on('</osm.relation.tag>', (node: { [k: string]: any }, parent?: { [k: string]: any }) => {
        (refElements.get(`relation/${parent?.id}`) as Relation).addTag(node.k, node.v);
    });

    // Derived relations replace the placeholder created at `<osm.relation>`.
    xmlParser.on('</osm.relation>', (node: { [k: string]: any }) => {
        if (hasDerivedGeometry(node)) {
            addDerivedFromXml('relation', node, refElements);
            return;
        }
        const relation = refElements.get(`relation/${node.id}`) as Relation;
        if (relation && node.$innerNodes) {
            for (const ind of node.$innerNodes) {
                if (ind.$tag === 'center') {
                    relation.setCenter(ind);
                    break;
                }
            }
        }
    });

    xmlParser.parse(osm);
};

function osm2geojson(osm: string | { [k: string]: any }, opts?: IOptions): FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined {
    let { completeFeature, renderTagged, excludeWay, elementId, tainted, polygonTags } = parseOptions(opts);

    let format = detectFormat(osm);

    const refElements = new RefElements();
    refElements.reportTainted = tainted;
    refElements.polygonTags = polygonTags;
    let featureArray: Feature<any, any>[] = [];

    if (format === 'json-raw') {
        osm = JSON.parse(osm as string) as { [k: string]: any };
        if ((osm as { [k: string]: any }).elements) {
            format = 'json';
        } else {
            format = 'invalid';
        }
    }

    if (format === 'json') {
        analyzeFeaturesFromJson(osm as { [k: string]: any }, refElements);
    } else if (format === 'xml') {
        analyzeFeaturesFromXml(osm as string, refElements);
    }

    refElements.bindAll();

    if (elementId) {
        const element = refElements.get(elementId);
        return element ? element.toFeatureArray()[0] : undefined;
    }

    for (const v of refElements.values()) {
        if (v.refCount > 0 && (!v.hasTag || !renderTagged || (v instanceof Way && excludeWay))) {
            continue;
        }
        const features = v.toFeatureArray();
        // return the first geometry of the first relation element
        if (v instanceof Relation && !completeFeature && features.length > 0) {
            return features[0].geometry;
        }
        for (const feature of features) {
            featureArray.push(feature);
        }
    }

    return { type: 'FeatureCollection', features: featureArray };
};

export default osm2geojson;
