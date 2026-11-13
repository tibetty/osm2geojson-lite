import { RefElements } from './ref-elements';
import { Way } from './way';
import type { PolygonTags } from './way';
import { Relation } from './relation';
import { mergeResolved, resolveElementHistory } from './elements';
import type { MergeConflict, MergedDocument } from './elements';
import { detectFormat } from './reader';
import type { OsmInput, Reader, Readers } from './reader';
import { analyzeElements } from './element-analyze';
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
    /**
     * Used by `applyOsmChange` and `mergeOsmChange`. When `true`, a change entry
     * whose version does not advance the base version throws instead of being
     * reported in `conflicts`.
     * @default false
     */
    strict?: boolean;
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

/**
 * Entry points differ only in which formats they can read, so they share one
 * implementation: the readers are injected, and anything the entry does not
 * know how to read is reported instead of silently half-converted.
 */
function selectReader(osm: OsmInput, readers: Readers, entry: string): [Reader, any] | undefined {
    let format = detectFormat(osm);
    let document: any = osm;

    if (format === 'json-raw') {
        document = JSON.parse(osm as string);
        format = document && document.elements ? 'json' : 'invalid';
    }
    if (format === 'invalid') {
        return undefined;
    }
    if (format === 'pbf') {
        document = document instanceof Uint8Array ? document : new Uint8Array(document as ArrayBuffer);
    }

    const reader = readers[format];
    if (reader === undefined) {
        throw new Error(`"${entry}" does not read ${format} input; use "osm2geojson-lite/${format}" or "osm2geojson-lite".`);
    }
    return [reader, document];
}

function analyzeInput(osm: OsmInput, refElements: RefElements, readers: Readers, entry: string): void {
    const selected = selectReader(osm, readers, entry);
    if (selected !== undefined) {
        selected[0].analyze(selected[1], refElements);
    }
}

function createRefElements({ tainted, polygonTags }: ReturnType<typeof parseOptions>): RefElements {
    const refElements = new RefElements();
    refElements.reportTainted = tainted;
    refElements.polygonTags = polygonTags;
    return refElements;
}

function buildFeatures(
    refElements: RefElements,
    { completeFeature, renderTagged, excludeWay, elementId }: ReturnType<typeof parseOptions>,
): FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined {
    refElements.bindAll();

    if (elementId) {
        const element = refElements.get(elementId);
        return element ? element.toFeatureArray()[0] : undefined;
    }

    releaseNonGeometryRelationMembers(refElements);
    ensureRelationCyclesHaveRoot(refElements);

    // A relation also reports its node members (stops, labels, `out geom`
    // member nodes), and separately registered members are emitted by their own
    // object. Keep the first feature per element so the collection never
    // carries two features with the same id.
    const emitted = new Set<string>();
    const featureArray: Feature<any, any>[] = [];

    for (const v of refElements.elements()) {
        if (v.refCount > 0 && (!v.hasTag || !renderTagged || (v instanceof Way && excludeWay))) {
            continue;
        }
        const features = v.toFeatureArray();
        // return the first geometry of the first relation element
        if (v instanceof Relation && !completeFeature && features.length > 0) {
            return features[0].geometry;
        }
        for (const feature of features) {
            const id = feature.id;
            if (typeof id === 'string') {
                if (emitted.has(id)) {
                    continue;
                }
                emitted.add(id);
            }
            featureArray.push(feature);
        }
    }

    return { type: 'FeatureCollection', features: featureArray };
}

function convert(osm: OsmInput, opts: IOptions | undefined, readers: Readers, entry: string): FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined {
    const options = parseOptions(opts);
    const refElements = createRefElements(options);
    analyzeInput(osm, refElements, readers, entry);
    return buildFeatures(refElements, options);
}

/**
 * Convert elements that are already in memory. The merged state of an
 * osmChange is no longer a document in any one format, and a format entry must
 * not be asked to read another format, so this bypasses detection.
 */
function convertElements(elements: any[], opts: IOptions | undefined): FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined {
    const options = parseOptions(opts);
    const refElements = createRefElements(options);
    analyzeElements({ elements }, refElements);
    return buildFeatures(refElements, options);
}

/** Read one document into raw element objects, without resolving them. */
function readElements(osm: OsmInput, readers: Readers, entry: string): any[] {
    const selected = selectReader(osm, readers, entry);
    return selected === undefined ? [] : selected[0].read(selected[1]);
}

export interface AppliedChange {
    geojson: FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined;
    /** Change entries that did not advance the base, in document order. */
    conflicts: MergeConflict[];
}

/**
 * Build the public API of one entry point: the same four functions for every
 * format set, so an entry can replace another with a one-line import change.
 */
export function createEntry(readers: Readers, entry: string) {
    /**
     * Normalise any supported input into Overpass-shaped element objects.
     *
     * Duplicate and multi-version copies are collapsed to the newest version,
     * and elements deleted at their newest version are dropped, so the result is
     * the current state of the document.
     */
    const toElements = (osm: OsmInput): any[] => resolveElementHistory(readElements(osm, readers, entry)).elements;

    /**
     * Apply an osmChange diff to a base extract, at the element level.
     *
     * A change only overrides what it advances: an entry whose version is not
     * newer than the base copy leaves the base intact and is reported in
     * `conflicts`. Elements absent from the base are creates and are appended.
     * Pass `{ strict: true }` to throw on the first conflict instead.
     */
    const mergeOsmChange = (base: OsmInput, change: OsmInput, opts?: IOptions): MergedDocument => {
        const baseDocument = resolveElementHistory(readElements(base, readers, entry));
        const changeDocument = resolveElementHistory(readElements(change, readers, entry));
        return mergeResolved(baseDocument, changeDocument, opts !== undefined && opts.strict === true);
    };

    /**
     * Apply an osmChange diff to a base extract and convert the resulting state.
     *
     * Conflicts are returned rather than thrown unless `{ strict: true }` is set,
     * so a pipeline can reconcile a mismatched pair instead of losing the output.
     */
    const applyOsmChange = (base: OsmInput, change: OsmInput, opts?: IOptions): AppliedChange => {
        const merged = mergeOsmChange(base, change, opts);
        return {
            geojson: convertElements(merged.elements, opts),
            conflicts: merged.conflicts,
        };
    };

    const osm2geojson = (osm: OsmInput, opts?: IOptions): FeatureCollection<GeometryObject> | Feature<any, any> | GeometryObject | undefined => {
        return convert(osm, opts, readers, entry);
    };

    return { osm2geojson, toElements, mergeOsmChange, applyOsmChange };
}

function ensureRelationCyclesHaveRoot(refElements: RefElements): void {
    const relations: Relation[] = [];
    for (const value of refElements.elements()) {
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
    for (const value of refElements.elements()) {
        if (!(value instanceof Relation)) {
            continue;
        }
        const kind = value.getGeometryKind();

        // Node members are never part of a line or polygon geometry; they are
        // stops, admin centres, labels, etc. and should stay independent.
        for (const node of value.getNodeMembers()) {
            if (node.refCount > 0) {
                node.refCount--;
            }
        }

        if (kind === 'none') {
            for (const way of value.ways) {
                if (way instanceof Way && way.refCount > 0) {
                    way.refCount--;
                }
            }
            for (const entry of value.getRelationEntries()) {
                if (entry.relation.refCount > 0) {
                    entry.relation.refCount--;
                }
            }
            continue;
        }

        if (kind === 'polygon') {
            // Only outer/inner/empty roles participate in the polygon.
            if (value.ways.length === value.roles.length) {
                for (let i = 0; i < value.ways.length; i++) {
                    const way = value.ways[i];
                    const role = value.roles[i];
                    if (way instanceof Way && role !== 'outer' && role !== 'inner' && role !== '' && way.refCount > 0) {
                        way.refCount--;
                    }
                }
            }
            for (const entry of value.getRelationEntries()) {
                const role = entry.role;
                if (role !== 'outer' && role !== 'inner' && role !== '' && entry.relation.refCount > 0) {
                    entry.relation.refCount--;
                }
            }
        } else if (kind === 'line') {
            if (value.ways.length === value.roles.length) {
                for (let i = 0; i < value.ways.length; i++) {
                    const way = value.ways[i];
                    if (way instanceof Way && value.roles[i] === 'platform' && way.refCount > 0) {
                        way.refCount--;
                    }
                }
            }
            for (const entry of value.getRelationEntries()) {
                if (entry.role === 'platform' && entry.relation.refCount > 0) {
                    entry.relation.refCount--;
                }
            }
        }
    }
}


export type { MergeConflict, MergedDocument } from './elements';
export type { OsmInput, Format, Reader, Readers } from './reader';
