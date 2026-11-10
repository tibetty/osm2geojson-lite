import { OsmObject } from "./osm-object";
import { Way } from "./way";
import { Node, LatLon } from "./node";
import { WayCollection } from "./way-collection";
import { LateBinder } from "./late-binder";
import { boundsToRing, first, isFiniteBounds, isFiniteCoordinate, pointInsidePolygon, ringBounds } from "./utils";
import type { RingBounds } from "./utils";
import type { RefElements } from "./ref-elements";
import type { BBox, Feature, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";

type WaysAndRoles = {
    ways: Way[];
    roles: string[];
};

/**
 * Assign each inner ring to the first outer ring that contains it.
 *
 * Small relations use the straightforward pairwise loop. Large ones use a
 * uniform grid over the outer rings so the candidate set is bounded by the
 * rings whose bounding boxes share a cell, rather than scanning every outer
 * ring for every inner ring.
 */
function linkInnerRings(
    outerRings: number[][][],
    innerRings: number[][][],
    compositePolygons: number[][][][],
    outerBounds: RingBounds[],
): void {
    const outerCount = outerRings.length;
    const innerCount = innerRings.length;
    if (innerCount === 0) {
        return;
    }

    if (outerCount <= 1 || innerCount <= 1 || outerCount * innerCount <= 256) {
        for (let i = 0; i < innerCount; i++) {
            const ring = innerRings[i];
            const pt = first(ring);
            for (let idx = 0; idx < outerCount; idx++) {
                const b = outerBounds[idx];
                if (pt[0] < b.minX || pt[0] > b.maxX || pt[1] < b.minY || pt[1] > b.maxY) {
                    continue;
                }
                if (pointInsidePolygon(pt, outerRings[idx])) {
                    compositePolygons[idx].push(ring);
                    break;
                }
            }
        }
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of outerBounds) {
        if (b.minX < minX) minX = b.minX;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxY > maxY) maxY = b.maxY;
    }

    const cells = Math.max(1, Math.ceil(Math.sqrt(outerCount)));
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const cellW = spanX > 0 ? spanX / cells : 0;
    const cellH = spanY > 0 ? spanY / cells : 0;
    const cellX = (x: number) => cellW > 0
        ? Math.min(cells - 1, Math.max(0, Math.floor((x - minX) / cellW)))
        : 0;
    const cellY = (y: number) => cellH > 0
        ? Math.min(cells - 1, Math.max(0, Math.floor((y - minY) / cellH)))
        : 0;

    const grid = new Map<number, number[]>();
    const globalCandidates: number[] = [];
    const maxCellsPerRing = cells * 4;

    for (let idx = 0; idx < outerCount; idx++) {
        const b = outerBounds[idx];
        const gx0 = cellX(b.minX);
        const gx1 = cellX(b.maxX);
        const gy0 = cellY(b.minY);
        const gy1 = cellY(b.maxY);
        // Very large rings would occupy most of the grid; keep them in a
        // shared list instead of inflating every cell.
        if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > maxCellsPerRing) {
            globalCandidates.push(idx);
            continue;
        }
        for (let gy = gy0; gy <= gy1; gy++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const key = gy * cells + gx;
                const bucket = grid.get(key);
                if (bucket) {
                    bucket.push(idx);
                } else {
                    grid.set(key, [idx]);
                }
            }
        }
    }

    for (let i = 0; i < innerCount; i++) {
        const ring = innerRings[i];
        const pt = first(ring);
        // Containment is tested with the ring's first point, so only the cell
        // containing that point needs to be queried.
        const candidates = new Set<number>(globalCandidates);
        const bucket = grid.get(cellY(pt[1]) * cells + cellX(pt[0]));
        if (bucket) {
            for (const idx of bucket) {
                candidates.add(idx);
            }
        }

        // Preserve the original first-outer-wins behaviour.
        const sorted = [...candidates].sort((a, b) => a - b);
        for (const idx of sorted) {
            const outer = outerBounds[idx];
            if (pt[0] < outer.minX || pt[0] > outer.maxX || pt[1] < outer.minY || pt[1] > outer.maxY) {
                continue;
            }
            if (pointInsidePolygon(pt, outerRings[idx])) {
                compositePolygons[idx].push(ring);
                break;
            }
        }
    }
}

export class Relation extends OsmObject {
    private relations: (LateBinder<Relation> | Relation)[] = [];
    private relationRoles: string[] = [];
    private nodes: (LateBinder<Node> | Node)[] = [];
    private nodeRoles: string[] = [];
    private bounds: number[] | undefined = undefined;
    private center: LatLon | null = null;
    public ways: (LateBinder<Way> | Way)[] = [];
    public roles: string[] = [];

    constructor(id: string, refElems: RefElements, register: boolean = true) {
        super('relation', id, refElems, register);
    }

    public setBounds(bounds: any[]) {
        if (isFiniteBounds(bounds)) {
            this.bounds = bounds;
        } else {
            this.tainted = true;
        }
    }

    public setCenter(center: LatLon) {
        if (isFiniteCoordinate(center.lat, center.lon)) {
            this.center = center;
        } else {
            this.tainted = true;
        }
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
                    // Keep a placeholder so roles stay aligned with members.
                    return new Relation(id, this.refElems, false);
                }, this, [member.ref], this.relationRoles, member.role || '');
                this.relations.push(binder);
                this.relationRoles.push(member.role || '');
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
                    }, this, [member.ref], this.roles, member.role);
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
                    if (!node.hasCoordinates()) {
                        this.tainted = true;
                    }
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
                    this.nodeRoles.push(member.role || '');
                } else {
                    let binder = new LateBinder(this.nodes, (id) => {
                        const nn = this.refElems.get(`node/${id}`) as Node;
                        if (nn && nn.hasCoordinates()) {
                            nn.refCount++;
                            return nn;
                        }
                        this.tainted = true;
                    }, this, [member.ref], this.nodeRoles, member.role || '');
                    this.nodes.push(binder);
                    this.nodeRoles.push(member.role || '');
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
            const compositePolygons: number[][][][] = [];
            const outerBounds: RingBounds[] = [];

            for (const ring of outerRings) {
                compositePolygons.push([ring]);
            }

            // Bounding boxes are only needed to cheaply reject inner rings.
            if (innerRings.length > 0) {
                for (const ring of outerRings) {
                    outerBounds.push(ringBounds(ring));
                }
                linkInnerRings(outerRings, innerRings, compositePolygons, outerBounds);
            }

            // construct the Polygon/MultiPolygon geometry
            if (compositePolygons.length === 1) {
                return {
                    type: 'Polygon',
                    coordinates: compositePolygons[0],
                };
            }

            return {
                type: 'MultiPolygon',
                coordinates: compositePolygons,
            };
        }

        return null;
    }

    public getSubRelations(): Relation[] {
        return this.relations.filter((relation): relation is Relation => relation instanceof Relation);
    }

    public getRelationEntries(): Array<{ relation: Relation; role: string }> {
        const entries: Array<{ relation: Relation; role: string }> = [];
        for (let i = 0; i < this.relations.length; i++) {
            const relation = this.relations[i];
            if (relation instanceof Relation) {
                entries.push({ relation, role: this.relationRoles[i] || '' });
            }
        }
        return entries;
    }

    public hasDirectGeometry(): boolean {
        return this.ways.length > 0 || this.nodes.length > 0 || this.center !== null || this.bounds !== undefined;
    }

    public getGeometryKind(): 'polygon' | 'line' | 'none' {
        const type = this.tags.type;
        if (type === 'multipolygon' || type === 'boundary') {
            return 'polygon';
        }
        if (type === 'route' || type === 'waterway' || type === 'multilinestring') {
            return 'line';
        }
        if (type) {
            // Known non-geometry relation types (restriction, site,
            // associatedStreet, route_master, stop_area, network, ...) and
            // unknown future types must not be turned into lines/polygons.
            return 'none';
        }
        // Compatibility fallback for legacy untagged relations.
        if (this.roles.indexOf('outer') >= 0 || this.roles.indexOf('inner') >= 0) {
            return 'polygon';
        }
        return this.ways.length > 0 || this.relations.length > 0 ? 'line' : 'none';
    }

    public getNodeMembers(): Node[] {
        return this.nodes.filter((node): node is Node => node instanceof Node);
    }

    /**
     * Old-style multipolygons put the descriptive tags on the single tagged
     * outer way and leave the relation with only `type`. Attribute the feature
     * to that way, as the OSM ecosystem expects.
     */
    private oldStyleOuterWay(): Way | null {
        if (this.getGeometryKind() !== 'polygon') {
            return null;
        }
        for (const key in this.tags) {
            if (key !== 'type') {
                return null;
            }
        }
        let outer: Way | null = null;
        let outerCount = 0;
        for (let i = 0; i < this.ways.length; i++) {
            const way = this.ways[i];
            if (!(way instanceof Way)) {
                continue;
            }
            const role = this.roles[i];
            if (role === 'outer' || role === '') {
                outerCount++;
                if (outerCount > 1) {
                    return null;
                }
                if (way.hasTag) {
                    outer = way;
                }
            }
        }
        return outerCount === 1 ? outer : null;
    }

    /**
     * Adopt the other copy's members when this copy has none. Returns true when
     * the other copy's member arrays were adopted, so its deferred binders must
     * be kept.
     */
    public adoptMembersFrom(other: Relation, preferOther: boolean): boolean {
        if (this.center === null && other.center) {
            this.center = other.center;
        }
        if (this.bounds === undefined && other.bounds) {
            this.bounds = other.bounds;
        }
        const thisCount = this.ways.length + this.relations.length + this.nodes.length;
        const otherCount = other.ways.length + other.relations.length + other.nodes.length;
        const takeOther = otherCount > 0 && (preferOther || thisCount === 0);
        if (takeOther) {
            this.ways = other.ways;
            this.roles = other.roles;
            this.relations = other.relations;
            this.nodes = other.nodes;
            return true;
        }
        return false;
    }

    /**
     * Flatten a relation and its sub-relations into a single way/role list.
     * Duplicate way references (a common cause of duplicated rings) are removed
     * while preserving the first occurrence and its role.
     *
     * This uses an explicit stack rather than recursion so very deep relation
     * chains cannot overflow the JS call stack.
     */
    private collectAllWaysForRelation(root: Relation, relationToWaysMap: Map<string, WaysAndRoles>): WaysAndRoles {
        if (!(root instanceof Relation)) {
            return { ways: [], roles: [] };
        }
        const cachedRoot = relationToWaysMap.get(root.id);
        if (cachedRoot) {
            return cachedRoot;
        }

        interface Frame {
            relation: Relation;
            ways: Way[];
            roles: string[];
            seenRelations: Set<string>;
            subIndex: number;
            subs: Array<{ relation: Relation; role: string }>;
        }

        const visiting = new Set<string>();
        const stack: Frame[] = [];

        const createFrame = (relation: Relation): Frame => {
            const kind = relation.getGeometryKind();
            const ways: Way[] = [];
            const roles: string[] = [];
            // Only deduplicate repeated members listed directly by *this*
            // relation (the cause of duplicated rings in issue #48). A way
            // shared by two sub-relations must still contribute once per
            // sub-relation, otherwise legitimate geometry would be dropped.
            const seen = new Set<string>();
            const addDirect = (way: Way, role: string) => {
                if (!way) {
                    relation.tainted = true;
                    return;
                }
                if (way.tainted) {
                    relation.tainted = true;
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
                if (kind === 'none') {
                    break;
                }
                const role = relation.roles[i];
                if (kind === 'polygon' && role !== 'outer' && role !== 'inner' && role !== '') {
                    continue;
                }
                if (kind === 'line' && role === 'platform') {
                    continue;
                }
                addDirect(relation.ways[i] as Way, role);
            }
            const subs = kind === 'none'
                ? []
                : relation.getRelationEntries().filter((entry) => {
                    if (kind === 'polygon') {
                        return entry.role === 'outer' || entry.role === 'inner' || entry.role === '';
                    }
                    if (kind === 'line') {
                        return entry.role !== 'platform';
                    }
                    return true;
                });
            return {
                relation,
                ways,
                roles,
                seenRelations: new Set(),
                subIndex: 0,
                subs,
            };
        };

        visiting.add(root.id);
        stack.push(createFrame(root));

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const subs = frame.subs;
            let descended = false;

            while (frame.subIndex < subs.length) {
                const sub = subs[frame.subIndex].relation;
                const id = sub.getCompositeId();
                if (frame.seenRelations.has(id)) {
                    frame.subIndex++;
                    continue;
                }
                frame.seenRelations.add(id);
                if (sub.tainted) {
                    frame.relation.tainted = true;
                }
                const cached = relationToWaysMap.get(sub.id);
                if (cached) {
                    for (let i = 0; i < cached.ways.length; i++) {
                        frame.ways.push(cached.ways[i]);
                        frame.roles.push(cached.roles[i]);
                    }
                    frame.subIndex++;
                    continue;
                }
                // A relation cycle (e.g. A -> B -> A) has no natural root.
                // Stop at the relation already on the stack; the outer
                // relation still contributes its direct ways.
                if (visiting.has(sub.id)) {
                    frame.subIndex++;
                    continue;
                }
                visiting.add(sub.id);
                stack.push(createFrame(sub));
                descended = true;
                break;
            }

            if (descended) {
                continue;
            }

            stack.pop();
            visiting.delete(frame.relation.id);
            const result = { ways: frame.ways, roles: frame.roles };
            relationToWaysMap.set(frame.relation.id, result);

            const parent = stack.length ? stack[stack.length - 1] : undefined;
            if (parent) {
                if (frame.relation.tainted) {
                    parent.relation.tainted = true;
                }
                for (let i = 0; i < result.ways.length; i++) {
                    parent.ways.push(result.ways[i]);
                    parent.roles.push(result.roles[i]);
                }
                parent.subIndex++;
                continue;
            }

            return result;
        }

        return { ways: [], roles: [] };
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        const polygonFeatures: Array<Feature<Polygon | MultiPolygon, any>> = [];
        const stringFeatures: Array<Feature<LineString | MultiLineString, any>> = [];
        let pointFeatures: Array<Feature<Point | MultiPoint, any>> = [];

        const relationToWaysMap: Map<string, WaysAndRoles> = new Map<string, WaysAndRoles>();
        const kind = this.getGeometryKind();
        const waysAndRoles = kind === 'none'
            ? { ways: [], roles: [] }
            : this.collectAllWaysForRelation(this, relationToWaysMap);

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
        if (kind === 'polygon') {
            const outerWayCollection = new WayCollection();
            const innerWayCollection = new WayCollection();
            for (let i = 0; i < waysAndRoles.ways.length; i++) {
                const way = waysAndRoles.ways[i];
                const role = waysAndRoles.roles[i];
                if (role === 'inner') {
                    innerWayCollection.addWay(way);
                    if (way.tainted) {
                        this.tainted = true;
                    }
                } else if (role === 'outer' || role === '') {
                    outerWayCollection.addWay(way);
                    if (way.tainted) {
                        this.tainted = true;
                    }
                }
            }
            const geometry = this.constructPolygonGeometry(outerWayCollection, innerWayCollection);
            if (geometry) {
                const oldStyleWay = this.oldStyleOuterWay();
                if (oldStyleWay) {
                    const properties: { [k: string]: any } = oldStyleWay.getProps();
                    if (this.tainted && this.refElems.reportTainted) {
                        properties['@tainted'] = true;
                    }
                    polygonFeatures.push({
                        type: 'Feature',
                        id: oldStyleWay.getCompositeId(),
                        properties,
                        geometry,
                    });
                } else {
                    const feature = Object.assign({}, templateFeature);
                    feature.geometry = geometry;
                    polygonFeatures.push(feature);
                }
                hasGeometry = true;
            }
        } else if (kind === 'line') {
            const wayCollection = new WayCollection();
            for (const way of waysAndRoles.ways) {
                wayCollection.addWay(way);
                if (way.tainted) {
                    this.tainted = true;
                }
            }
            const geometry = this.constructStringGeometry(wayCollection);
            if (geometry) {
                const feature = Object.assign({}, templateFeature);
                feature.geometry = geometry;
                stringFeatures.push(feature);
                hasGeometry = true;
            }
        }

        // `out bb` responses may only carry a bounding box.
        if (kind !== 'none' && !hasGeometry && this.bounds) {
            const feature = Object.assign({}, templateFeature);
            feature.geometry = {
                type: 'Polygon',
                coordinates: [boundsToRing(this.bounds)],
            };
            polygonFeatures.push(feature);
            hasGeometry = true;
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

        // Ways are only converted/normalised while assembling geometry, so a
        // taint discovered there (e.g. null `out geom` coordinates) must be
        // reflected in the feature properties.
        if (this.tainted) {
            const properties = this.getProps();
            const relationId = this.getCompositeId();
            for (const feature of polygonFeatures) {
                if (feature.id === relationId) {
                    feature.properties = properties;
                }
            }
            for (const feature of stringFeatures) {
                if (feature.id === relationId) {
                    feature.properties = properties;
                }
            }
            for (const feature of pointFeatures) {
                if (feature.id === relationId) {
                    feature.properties = properties;
                }
            }
        }

        for (const node of this.nodes) {
            pointFeatures = pointFeatures.concat((node as Node).toFeatureArray());
        }

        return [...polygonFeatures, ...stringFeatures, ...pointFeatures];
    }
}
