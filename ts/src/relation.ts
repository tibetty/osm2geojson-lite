import { OsmObject } from "./osm-object";
import { Way } from "./way";
import { Node } from "./node";
import { WayCollection } from "./way-collection";
import { LateBinder } from "./late-binder";
import { first, pointInsidePolygon } from "./utils";
import type { RefElements } from "./ref-elements";
import type { BBox, Feature, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";

export class Relation extends OsmObject {
    private relations: (LateBinder | Relation)[] = [];
    private nodes: (LateBinder | Node)[] = [];
    private bounds: number[] | undefined = undefined;

    public waysPerRole: Record<string, WayCollection> = {};

    constructor(id: string, refElems: RefElements) {
        super('relation', id, refElems);
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
                let ways = this.waysPerRole[member.role];
                if (!ways) {
                    ways = this.waysPerRole[member.role] = new WayCollection();
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
                break;
            default:
                break;
        }
    }

    private constructStringGeometry(ws: WayCollection): LineString | MultiLineString | null {
        const strings = ws ? ws.mergeWays() : [];
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

    private constructPolygonGeometry(ows: WayCollection, iws: WayCollection): Polygon | MultiPolygon | null {
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
                    if (pointInsidePolygon(first(ring), outerRings[idx])) {
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

    public toFeatureArray(): Array<Feature<any, any>> {
        const polygonFeatures: Array<Feature<Polygon | MultiPolygon, any>> = [];
        const stringFeatures: Array<Feature<LineString | MultiLineString, any>> = [];
        let pointFeatures: Array<Feature<Point | MultiPoint, any>> = [];

        for (const relation of this.relations) {
            if (!relation) {
                continue;
            }
            for (const fieldName of Object.keys((relation as Relation).waysPerRole)) {
                const ways = (relation as Relation).waysPerRole[fieldName];
                if (!ways) {
                    continue;
                }
                const thisWays = this.waysPerRole[fieldName];
                if (thisWays) {
                    thisWays.push(...ways);
                } else {
                    this.waysPerRole[fieldName] = ways;
                }
            }
        }

        let waysFieldNames = Object.keys(this.waysPerRole);
        for (const fieldName of waysFieldNames) {
            const ways = this.waysPerRole[fieldName];
            if (!ways) {
                continue;
            }
            this.waysPerRole[fieldName] = new WayCollection();
            for (const way of ways) {
                this.waysPerRole[fieldName].addWay(way);
            }
        }

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

        if (this.waysPerRole.outer) {
            let feature = Object.assign({}, templateFeature);
            let geometry = this.constructPolygonGeometry(this.waysPerRole.outer, this.waysPerRole.inner);
            if (geometry) {
                feature.geometry = geometry;
                polygonFeatures.push(feature);
            }
        } else {
            let multiLineGeometry: MultiLineString = {
                type: 'MultiLineString',
                coordinates: []
            };

            for (let fieldName of waysFieldNames) {
                if (fieldName == null || fieldName === 'inner') {
                    continue;
                }
                let wayCollection = this.waysPerRole[fieldName];
                if (!wayCollection) {
                    continue;
                }
                let geometry = this.constructStringGeometry(wayCollection);
                if (!geometry) {
                    continue;
                }
                if (geometry.type === 'LineString') {
                    multiLineGeometry.coordinates.push(geometry.coordinates);
                } else if (geometry.type === 'MultiLineString') {
                    let feature = Object.assign({}, templateFeature);
                    feature.geometry = geometry;
                    stringFeatures.push(feature);
                }
            }

            if (multiLineGeometry.coordinates.length > 0) {
                let feature = Object.assign({}, templateFeature);
                feature.geometry = multiLineGeometry;
                stringFeatures.push(feature);
            }
        }

        for (let node of this.nodes) {
            pointFeatures = pointFeatures.concat((node as Node).toFeatureArray());
        }

        return [...polygonFeatures, ...stringFeatures, ...pointFeatures];
    }
}