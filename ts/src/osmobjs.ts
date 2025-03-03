import {
    Feature, GeometryObject, LineString,
    MultiLineString, MultiPoint, MultiPolygon,
    Point, Polygon, BBox
} from 'geojson';

import { first, isRing, last, ptInsidePolygon, ringDirection, strToFloat } from './utils';
import { LateBinder, RefElements, WayCollection } from './utils';

import polygonTags from './polytags.json';

class OsmObject {
    public refCount: number;

    protected refElems: RefElements;

    private type: string;
    private id: string;
    private tags: { [k: string]: string };
    private props: { [k: string]: string };
    private hasTag: boolean;

    constructor(type: string, id: string, refElems: RefElements) {
        this.type = type;
        this.id = id;
        this.refElems = refElems;
        this.tags = {};
        this.props = { id: this.getCompositeId() };
        this.refCount = 0;
        this.hasTag = false;
        if (refElems) {
            refElems.add(this.getCompositeId(), this);
        }
    }

    public addTags(tags: { [k: string]: string }) {
        this.tags = Object.assign(this.tags, tags);
        this.hasTag = tags ? true : false;
    }

    public addTag(k: string, v: string) {
        this.tags[k] = v;
        this.hasTag = k ? true : false;
    }

    public addProp(k: string, v: any) {
        this.props[k] = v;
    }

    public addProps(props: { [k: string]: string }) {
        this.props = Object.assign(this.props, props);
    }

    public getCompositeId(): string {
        return `${this.type}/${this.id}`;
    }

    public getProps(): { [k: string]: string } {
        return Object.assign(this.props, this.tags);
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        return [];
    }
}

export class Node extends OsmObject {
    private latLng: { lon: string, lat: string } | null;

    constructor(id: string, refElems: RefElements) {
        super('node', id, refElems);
        this.latLng = null;
    }

    public setLatLng(latLng: { lat: string, lon: string }) {
        this.latLng = latLng;
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        if (this.latLng) {
            return [{
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'Point',
                    coordinates: strToFloat([this.latLng.lon, this.latLng.lat]),
                },
            }];
        }
        return [];
    }

    public getLatLng(): { lat: string, lon: string } | null {
        return this.latLng;
    }
}

export class Way extends OsmObject {
    private latLngArray: Array<{ lon: string, lat: string } | LateBinder>;
    private isPolygon: boolean;

    constructor(id: string, refElems: RefElements) {
        super('way', id, refElems);
        this.latLngArray = [];
        this.isPolygon = false;
    }

    public addLatLng(latLng: { lat: string, lon: string }) {
        this.latLngArray.push(latLng);
    }

    public setLatLngArray(latLngArray: Array<{ lat: string, lon: string, [k: string]: any }>) {
        this.latLngArray = latLngArray;
    }

    public addNodeRef(ref: string) {
        const binder = new LateBinder(this.latLngArray, (id: string) => {
            const node = this.refElems.get(`node/${id}`);
            if (node) {
                node.refCount++;
                return node.getLatLng();
            }
        }, this, [ref]);

        this.latLngArray.push(binder);
        this.refElems.addBinder(binder);
    }

    public addTags(tags: { [k: string]: string }) {
        super.addTags(tags);
        for (const [k, v] of Object.entries(tags)) {
            this.analyzeTag(k, v);
        }
    }

    public addTag(k: string, v: string) {
        super.addTag(k, v);
        this.analyzeTag(k, v);
    }

    public toCoordsArray(): string[][] {
        return (this.latLngArray as Array<{ lon: string, lat: string }>).map((latLng) => [latLng.lon, latLng.lat]);
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        let coordsArray: any[] = this.toCoordsArray();
        if (coordsArray.length > 1) {
            coordsArray = strToFloat(coordsArray);
            const feature: Feature<any, any> = {
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'LineString',
                    coordinates: coordsArray,
                },
            };

            if (this.isPolygon && isRing(coordsArray)) {
                if (ringDirection(coordsArray) !== 'counterclockwise') {
                    coordsArray.reverse();
                }

                feature.geometry = {
                    type: 'Polygon',
                    coordinates: [coordsArray],
                };

                return [feature];
            }

            return [feature];
        }

        return [];
    }

    private analyzeTag(k: string, v: string) {
        const o = (polygonTags as Record<string, { whitelist?: string[], blacklist?: string[] } >)[k];
        if (o) {
            this.isPolygon = true;
            if (o.whitelist) {
                this.isPolygon = o.whitelist.indexOf(v) >= 0 ? true : false;
            } else if (o.blacklist) {
                this.isPolygon = o.blacklist.indexOf(v) >= 0 ? false : true;
            }
        }
    }
}

export class Relation extends OsmObject {
    private relations: any[];
    private nodes: any[];
    private bounds: number[] | undefined;

    [k: string]: any;

    constructor(id: string, refElems: RefElements) {
        super('relation', id, refElems);
        this.relations = [];
        this.nodes = [];
        this.bounds = undefined;
    }

    public setBounds(bounds: any[]) {
        this.bounds = bounds;
    }

    public addMember(member: { [k: string]: any }) {
        switch (member.type) {
            // super relation, need to do combination
            case 'relation':
                let binder = new LateBinder(this.relations, (id: string) => {
                    const relation = this.refElems.get(`relation/${id}`);
                    if (relation) {
                        relation.refCount++;
                        return relation;
                    }
                }, this, [member.ref]);
                this.relations.push(binder);
                this.refElems.addBinder(binder);
                break;

            case 'way':
                if (!member.role) {
                    member.role = '';
                }
                let ways = this[member.role];
                if (!ways) {
                    ways = this[member.role] = [];
                }
                if (member.geometry) {
                    const way = new Way(member.ref, this.refElems);
                    way.setLatLngArray(member.geometry);
                    way.refCount++;
                    ways.push(way);
                } else if (member.nodes) {
                    const way = new Way(member.ref, this.refElems);
                    for (const nid of member.nodes) {
                        way.addNodeRef(nid);
                    }
                    way.refCount++;
                    ways.push(way);
                } else {
                    let binder = new LateBinder(ways, (nid) => {
                        const way = this.refElems.get(`way/${nid}`);
                        if (way) {
                            way.refCount++;
                            return way;
                        }
                    }, this, [member.ref]);
                    ways.push(binder);
                    this.refElems.addBinder(binder);
                }
                break;

            case 'node':
                let node: Node | null = null;
                if (member.lat && member.lon) {
                    node = new Node(member.ref, this.refElems);
                    node.setLatLng({ lon: member.lon, lat: member.lat });
                    if (member.tags) {
                        node.addTags(member.tags);
                    }
                    for (const [k, v] of Object.entries(member)) {
                        if (['id', 'type', 'lat', 'lon'].indexOf(k) < 0) {
                            node.addProp(k, v);
                        }
                    }

                    node.refCount++;
                    this.nodes.push(node);
                } else {
                    let binder = new LateBinder(this.nodes, (id) => {
                        const nn = this.refElems.get(`node/${id}`);
                        if (nn) {
                            nn.refCount++;
                            return nn;
                        }
                    }, this, [member.ref]);
                    this.nodes.push(binder);
                    this.refElems.addBinder(binder);
                }
            default:
                break;
        }
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        function constructStringGeometry(ws: WayCollection): LineString | MultiLineString | null {
            const strings = ws ? ws.toStrings() : [];
            if (strings.length > 0) {
                if (strings.length === 1) {
                    return {
                        type: 'LineString',
                        coordinates: strings[0],
                    };
                }

                return {
                    type: 'MultiLineString',
                    coordinates: strings,
                };
            }
            return null;
        }

        function constructPolygonGeometry(ows: WayCollection, iws: WayCollection): Polygon | MultiPolygon | null {
            const outerRings = ows ? ows.toRings('counterclockwise') : [];
            const innerRings = iws ? iws.toRings('clockwise') : [];

            if (outerRings.length > 0) {
                const compositPolyons: any[] = [];

                let ring: number[][] | undefined;
                for (ring of outerRings) {
                    compositPolyons.push([ring]);
                }

                // link inner polygons to outer containers
                ring = innerRings.shift();
                while (ring) {
                    for (const idx in outerRings) {
                        if (ptInsidePolygon(first(ring), outerRings[idx])) {
                            compositPolyons[idx].push(ring);
                            break;
                        }
                    }
                    ring = innerRings.shift();
                }

                // construct the Polygon/MultiPolygon geometry
                if (compositPolyons.length === 1) {
                    return {
                        type: 'Polygon',
                        coordinates: compositPolyons[0],
                    };
                }

                return {
                    type: 'MultiPolygon',
                    coordinates: compositPolyons,
                };
            }

            return null;
        }

        const polygonFeatures: Array<Feature<Polygon | MultiPolygon, any>> = [];
        const stringFeatures: Array<Feature<LineString | MultiLineString, any>> = [];
        let pointFeatures: Array<Feature<Point | MultiPoint, any>> = [];

        // need to do combination when there're nested relations
        const notWayFields = ['type', 'id', 'refElems', 'tags', 'props', 'refCount', 'hasTag', 'relations', 'nodes', 'bounds'];
        for (const relation of this.relations) {
            if (relation) {
                let waysFieldNames = Object.keys(relation).filter(fieldName => notWayFields.indexOf(fieldName) < 0);
                for (const fieldName of waysFieldNames) {
                    const ways = relation[fieldName];
                    if (ways) {
                        const thisWays = this[fieldName];
                        if (thisWays) {
                            thisWays.push(...ways);
                        } else {
                            this[fieldName] = ways;
                        }
                    }
                }
            }
        }

        let waysFieldNames = Object.keys(this).filter(fieldName => notWayFields.indexOf(fieldName) < 0);
        for (const fieldName of waysFieldNames) {
            const ways = this[fieldName];
            if (ways) {
                this[fieldName] = new WayCollection();
                for (const way of ways) {
                    this[fieldName].addWay(way);
                }
            }
        }

        let geometry: GeometryObject | null = null;

        let templateFeature: Feature<any, any> = {
            type: 'Feature',
            id: this.getCompositeId(),
            bbox: this.bounds as BBox,
            properties: this.getProps(),
            geometry: null
        };

        if (!this.bounds) {
            delete templateFeature.bbox;
        }

        if (this.outer) {
            let feature = Object.assign({}, templateFeature);
            let geometry = constructPolygonGeometry(this.outer, this.inner);
            if (geometry) {
                feature.geometry = geometry;
                polygonFeatures.push(feature);
            }
        }
        else {
            let multiLineGeometry: MultiLineString = {
                type: 'MultiLineString',
                coordinates: []
            };

            for (let way of waysFieldNames) {
                if (way != null && way !== 'inner') {
                    let ws = this[way];
                    if (ws) {
                        let geometry = constructStringGeometry(ws);
                        if (geometry) {
                            if (geometry.type === 'LineString') {
                                multiLineGeometry.coordinates.push(geometry.coordinates);
                            } else if (geometry.type === 'MultiLineString') {
                                let feature = Object.assign({}, templateFeature);
                                feature.geometry = geometry;
                                stringFeatures.push(feature);
                            }
                        }
                    }
                }
            }

            if (multiLineGeometry.coordinates.length > 0) {
                let feature = Object.assign({}, templateFeature);
                feature.geometry = multiLineGeometry;
                stringFeatures.push(feature);
            }
        }

        for (let node of this.nodes) {
            pointFeatures = pointFeatures.concat(node.toFeatureArray());
        }

        return [...polygonFeatures, ...stringFeatures, ...pointFeatures];
    }
}
