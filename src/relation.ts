import { OsmObject } from "./osm-object";
import { Way } from "./way";
import { Node, LatLon } from "./node";
import { WayCollection } from "./way-collection";
import { LateBinder } from "./late-binder";
import { first, pointInsidePolygon } from "./utils";
import type { RefElements } from "./ref-elements";
import type { BBox, Feature, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";

type WaysAndRoles = {
    ways: Way[];
    roles: string[];
};

export class Relation extends OsmObject {
    private relations: (LateBinder<Relation> | Relation)[] = [];
    private nodes: (LateBinder<Node> | Node)[] = [];
    private bounds: number[] | undefined = undefined;
    private center: LatLon | null = null;
    public ways: (LateBinder<Way> | Way)[] = [];
    public roles: string[] = [];

    constructor(id: string, refElems: RefElements, register: boolean = true) {
        super('relation', id, refElems, register);
    }

    public setBounds(bounds: any[]) {
        this.bounds = bounds;
    }

    public setCenter(center: LatLon) {
        this.center = center;
    }

    public addMember(member: { [k: string]: any }) {
        switch (member.type) {
            // super relation, need to do combination
            case 'relation':
                let binder = new LateBinder(this.relations, (id: string) => {
                    const relation = this.refElems.get(`relation/${id}`) as Relation;
                    if (relation) {
                        relation.refCount++;
                        return relation;
                    }
                    this.tainted = true;
                    // Keep a placeholder so `roles` stays aligned with `ways`.
                    return new Relation(id, this.refElems, false);
                }, this, [member.ref]);
                this.relations.push(binder);
                this.refElems.addBinder(binder);
                break;

            case 'way':
                if (!member.role) {
                    member.role = '';
                }
                if (member.geometry) {
                    const way = new Way(member.ref, this.refElems, false);
                    way.setLatLngArray(member.geometry);
                    way.refCount++;
                    this.ways.push(way);
                    this.roles.push(member.role);
                } else if (member.nodes) {
                    const way = new Way(member.ref, this.refElems, false);
                    for (const nid of member.nodes) {
                        way.addNodeRef(nid);
                    }
                    way.refCount++;
                    this.ways.push(way);
                    this.roles.push(member.role);
                } else {
                    let binder = new LateBinder(this.ways, (nid) => {
                        const way = this.refElems.get(`way/${nid}`) as Way;
                        if (way) {
                            way.refCount++;
                            return way;
                        }
                        this.tainted = true;
                        // Keep a placeholder so `roles` stays aligned with `ways`.
                        return new Way(nid, this.refElems, false);
                    }, this, [member.ref]);
                    this.ways.push(binder);
                    this.roles.push(member.role);
                    this.refElems.addBinder(binder);
                }
                break;

            case 'node':
                let node: Node | null = null;
                if (member.lat !== undefined && member.lon !== undefined) {
                    node = new Node(member.ref, this.refElems, false);
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
                        const nn = this.refElems.get(`node/${id}`) as Node;
                        if (nn) {
                            nn.refCount++;
                            return nn;
                        }
                        this.tainted = true;
                    }, this, [member.ref]);
                    this.nodes.push(binder);
                    this.refElems.addBinder(binder);
                }
                break;
        }
    }

    private constructStringGeometry(ws: WayCollection): MultiLineString | null {
        const strings = ws ? ws.mergeWays() : [];
        if (strings.length === 0) {
            return null;
        }

        return {
            type: 'MultiLineString',
            coordinates: strings,
        };
    }

    private constructPolygonGeometry(ows: WayCollection, iws: WayCollection): Polygon | MultiPolygon | null {
        const outerRings = ows ? ows.toRings('counterclockwise') : [];
        const innerRings = iws ? iws.toRings('clockwise') : [];

        if (outerRings.length > 0) {
            const compositPolyons: any[] = [];
            const outerBounds: { minX: number, maxX: number, minY: number, maxY: number }[] = [];

            for (const ring of outerRings) {
                compositPolyons.push([ring]);
            }

            // Bounding boxes are only needed to cheaply reject inner rings.
            if (innerRings.length > 0) {
                for (const ring of outerRings) {
                    outerBounds.push(ringBounds(ring));
                }
            }

            // Link inner rings to their outer container. A bbox pre-check avoids
            // the full ray cast for rings that cannot possibly be contained.
            for (let i = 0; i < innerRings.length; i++) {
                const ring = innerRings[i];
                const pt = first(ring);
                for (let idx = 0; idx < outerRings.length; idx++) {
                    const b = outerBounds[idx];
                    if (pt[0] < b.minX || pt[0] > b.maxX || pt[1] < b.minY || pt[1] > b.maxY) {
                        continue;
                    }
                    if (pointInsidePolygon(pt, outerRings[idx])) {
                        compositPolyons[idx].push(ring);
                        break;
                    }
                }
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

    /**
     * Flatten a relation and its sub-relations into a single way/role list.
     * Duplicate way references (a common cause of duplicated rings) are removed
     * while preserving the first occurrence and its role.
     */
    private collectAllWaysForRelation(relation: Relation, relationToWaysMap: Map<string, WaysAndRoles>): WaysAndRoles {
        const cached = relationToWaysMap.get(relation.id);
        if (cached) {
            return cached;
        }

        const ways: Way[] = [];
        const roles: string[] = [];
        // Only deduplicate repeated members listed directly by *this* relation
        // (the cause of duplicated rings in issue #48). A way shared by two
        // sub-relations must still contribute once per sub-relation, otherwise
        // legitimate geometry (e.g. a way forming part of two different
        // routes) would be dropped.
        const seen = new Set<string>();
        const addDirect = (way: Way, role: string) => {
            if (!way) {
                relation.tainted = true;
                return;
            }
            const key = way.getCompositeId() + '\n' + role;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            ways.push(way);
            roles.push(role);
        };

        for (let i = 0; i < relation.ways.length; i++) {
            addDirect(relation.ways[i] as Way, relation.roles[i]);
        }

        // A sub-relation listed more than once would otherwise duplicate all of
        // its ways. Sharing a way between *different* sub-relations remains
        // valid and is intentionally preserved.
        const seenRelations = new Set<string>();
        for (const subRelation of relation.relations as Relation[]) {
            if (!subRelation) {
                relation.tainted = true;
                continue;
            }
            const id = subRelation.getCompositeId();
            if (seenRelations.has(id)) {
                continue;
            }
            seenRelations.add(id);
            const entry = this.collectAllWaysForRelation(subRelation, relationToWaysMap);
            for (let i = 0; i < entry.ways.length; i++) {
                ways.push(entry.ways[i]);
                roles.push(entry.roles[i]);
            }
        }

        const result = { ways, roles };
        relationToWaysMap.set(relation.id, result);
        return result;
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        const polygonFeatures: Array<Feature<Polygon | MultiPolygon, any>> = [];
        const stringFeatures: Array<Feature<LineString | MultiLineString, any>> = [];
        let pointFeatures: Array<Feature<Point | MultiPoint, any>> = [];

        const relationToWaysMap: Map<string, WaysAndRoles> = new Map<string, WaysAndRoles>();
        const waysAndRoles = this.collectAllWaysForRelation(this, relationToWaysMap);

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

        let hasGeometry = false;
        if (waysAndRoles.roles.some((r) => r === 'outer')) {
            const outerWayCollection = new WayCollection();
            const innerWayCollection = new WayCollection();
            for (let i = 0; i < waysAndRoles.ways.length; i++) {
                const way = waysAndRoles.ways[i];
                const role = waysAndRoles.roles[i];
                if (role === 'outer') {
                    outerWayCollection.addWay(way);
                } else if (role === 'inner') {
                    innerWayCollection.addWay(way);
                }
            }
            const geometry = this.constructPolygonGeometry(outerWayCollection, innerWayCollection);
            if (geometry) {
                const feature = Object.assign({}, templateFeature);
                feature.geometry = geometry;
                polygonFeatures.push(feature);
                hasGeometry = true;
            }
        } else {
            const wayCollection = new WayCollection();
            for (const way of waysAndRoles.ways) {
                wayCollection.addWay(way);
            }
            const geometry = this.constructStringGeometry(wayCollection);
            if (geometry) {
                const feature = Object.assign({}, templateFeature);
                feature.geometry = geometry;
                stringFeatures.push(feature);
                hasGeometry = true;
            }
        }

        // `out center` / derived responses may only carry a centre point.
        if (!hasGeometry && this.center) {
            const feature = Object.assign({}, templateFeature);
            feature.geometry = {
                type: 'Point',
                coordinates: [+this.center.lon, +this.center.lat],
            };
            pointFeatures.push(feature);
        }

        for (const node of this.nodes) {
            pointFeatures = pointFeatures.concat((node as Node).toFeatureArray());
        }

        return [...polygonFeatures, ...stringFeatures, ...pointFeatures];
    }
}

function ringBounds(ring: number[][]): { minX: number, maxX: number, minY: number, maxY: number } {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
        const point = ring[i];
        const x = point[0];
        const y = point[1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
}
