import { purgeProps } from './utils';
import { parseOsmXml } from './osm-xml';
import { LatLon, Node } from './node';
import { Way } from './way';
import type { PolygonTags } from './way';
import { Relation } from './relation';
import { Output } from './output';
import { RefElements } from './ref-elements';
import type { Feature, FeatureCollection, GeometryObject } from 'geojson';

export interface IOptions {
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

function elementRank(elem: { [k: string]: any }): [number, number] {
    return [Number(elem.version) || 0, Object.keys(elem).length];
}

/**
 * Overpass unions can return the same element more than once, sometimes as a
 * skeleton (tags only) and sometimes with geometry. Keep the newest/most
 * complete copy but fill missing fields from the other copies so geometry and
 * tags are not lost.
 */
function deduplicateElements(elements: any[]): any[] {
    const best = new Map<string, any>();
    const order: string[] = [];
    const extra: any[] = [];

    for (const elem of elements) {
        if (!elem || elem.type === undefined || elem.id === undefined) {
            extra.push(elem);
            continue;
        }
        const key = `${elem.type}/${elem.id}`;
        const previous = best.get(key);
        if (!previous) {
            best.set(key, elem);
            order.push(key);
            continue;
        }
        const winner = elementRank(elem) > elementRank(previous) ? elem : previous;
        const loser = winner === elem ? previous : elem;
        const merged: { [k: string]: any } = { ...loser, ...winner };
        if (winner.tags || loser.tags) {
            merged.tags = { ...(loser.tags || {}), ...(winner.tags || {}) };
        }
        best.set(key, merged);
    }

    return [...extra, ...order.map((key) => best.get(key)!)];
}

function analyzeFeaturesFromJson(osm: { [k: string]: any }, refElements: RefElements): void {
    const elements = Array.isArray(osm.elements) ? deduplicateElements(osm.elements) : [];
    for (const elem of elements) {
        // Deleted elements from history/Overpass should not produce geometry.
        if (elem.visible === false || elem.visible === 'false') {
            continue;
        }
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
                } else if (elem.bounds) {
                    way.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
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

function analyzeFeaturesFromXml(osm: string, refElements: RefElements): void {
    parseOsmXml(osm, refElements);
};

/**
 * A closed relation cycle has no unreferenced relation, so the refCount-based
 * output filter would drop the whole cycle. Pick one relation per unreachable
 * strongly connected component and treat it as a root.
 */
function ensureRelationCyclesHaveRoot(refElements: RefElements): void {
    const relations: Relation[] = [];
    for (const value of refElements.values()) {
        if (value instanceof Relation) {
            relations.push(value);
        }
    }
    if (relations.length === 0) {
        return;
    }

    const present = new Set<string>();
    for (const relation of relations) {
        present.add(relation.getCompositeId());
    }

    const graph = new Map<Relation, Relation[]>();
    for (const relation of relations) {
        graph.set(relation, relation.getSubRelations().filter((sub) => present.has(sub.getCompositeId())));
    }

    // Anything reachable from an existing root is already covered by that
    // root's feature.
    const reachable = new Set<Relation>();
    const queue: Relation[] = [];
    for (const relation of relations) {
        if (relation.refCount === 0) {
            reachable.add(relation);
            queue.push(relation);
        }
    }
    while (queue.length > 0) {
        const relation = queue.pop()!;
        for (const sub of graph.get(relation)!) {
            if (!reachable.has(sub)) {
                reachable.add(sub);
                queue.push(sub);
            }
        }
    }

    // Iterative Tarjan SCC so deeply nested relations cannot overflow the stack.
    let nextIndex = 0;
    const indices = new Map<Relation, number>();
    const lowLinks = new Map<Relation, number>();
    const onStack = new Set<Relation>();
    const sccStack: Relation[] = [];

    for (const start of relations) {
        if (indices.has(start)) {
            continue;
        }
        const frames: { relation: Relation, subs: Relation[], next: number }[] = [];
        const enter = (relation: Relation) => {
            indices.set(relation, nextIndex);
            lowLinks.set(relation, nextIndex);
            nextIndex++;
            sccStack.push(relation);
            onStack.add(relation);
            frames.push({ relation, subs: graph.get(relation)!, next: 0 });
        };
        enter(start);

        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            if (frame.next < frame.subs.length) {
                const sub = frame.subs[frame.next++];
                if (!indices.has(sub)) {
                    enter(sub);
                } else if (onStack.has(sub)) {
                    lowLinks.set(frame.relation, Math.min(lowLinks.get(frame.relation)!, indices.get(sub)!));
                }
                continue;
            }

            frames.pop();
            const relation = frame.relation;
            if (frames.length > 0) {
                const parent = frames[frames.length - 1].relation;
                lowLinks.set(parent, Math.min(lowLinks.get(parent)!, lowLinks.get(relation)!));
            }

            if (lowLinks.get(relation) !== indices.get(relation)) {
                continue;
            }

            const component: Relation[] = [];
            let member: Relation = relation;
            do {
                member = sccStack.pop()!;
                onStack.delete(member);
                component.push(member);
            } while (member !== relation);

            const cyclic = component.length > 1 || graph.get(relation)!.indexOf(relation) >= 0;
            if (!cyclic || component.some((node) => reachable.has(node))) {
                continue;
            }

            let root = component[0];
            for (const node of component) {
                if (node.hasDirectGeometry()) {
                    root = node;
                    break;
                }
            }
            root.refCount = 0;
        }
    }
}

/**
 * Relations without a geometry type (restriction, site, associatedStreet,
 * route_master, stop_area, ...) must not absorb their members. Their members
 * should be emitted as independent features, so release the reference counts
 * contributed by those relations.
 */
function releaseNonGeometryRelationMembers(refElements: RefElements): void {
    for (const value of refElements.values()) {
        if (!(value instanceof Relation) || value.getGeometryKind() !== 'none') {
            continue;
        }
        for (const way of value.ways) {
            if (way instanceof Way && way.refCount > 0) {
                way.refCount--;
            }
        }
        for (const relation of value.getSubRelations()) {
            if (relation.refCount > 0) {
                relation.refCount--;
            }
        }
        for (const node of value.getNodeMembers()) {
            if (node.refCount > 0) {
                node.refCount--;
            }
        }
    }
}

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

    releaseNonGeometryRelationMembers(refElements);
    ensureRelationCyclesHaveRoot(refElements);

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
