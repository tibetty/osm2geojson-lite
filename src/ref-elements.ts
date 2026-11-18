import { Node } from "./node";
import { Relation } from "./relation";
import { Way } from "./way";
import type { OsmObject } from "./osm-object";
import type { PolygonTags } from "./way";

/**
 * The element registry of one conversion.
 *
 * Readers hand over resolved elements (`resolveElementHistory` already
 * collapsed duplicates and versions and dropped deletions), so registration is
 * a plain append; references are bound in bulk once everything is registered.
 */
export class RefElements {
    /** When true, features with unresolved references expose `@tainted: true`. */
    public reportTainted: boolean;
    /** Overrides the built-in polygon tag rules when provided. */
    public polygonTags: PolygonTags | undefined;

    /** Elements in registration order, which is the output order. */
    private ordered: OsmObject[];
    /** Other element types (Overpass `convert`, `make`, custom tags). */
    private others: Map<string, OsmObject>;
    /** Ways holding unresolved node references, resolved in one pass. */
    private pendingWays: Set<Way>;
    /** Relations holding unresolved member references. */
    private pendingRelations: Set<Relation>;
    /**
     * Nodes, ways and relations indexed by their raw id, so resolving a
     * reference does not have to build a `type/<id>` string for each one.
     */
    private nodes: Map<any, Node>;
    private wayIndex: Map<any, Way>;
    private relationIndex: Map<any, Relation>;

    constructor() {
        this.ordered = [];
        this.others = new Map();
        this.pendingWays = new Set();
        this.pendingRelations = new Set();
        this.nodes = new Map();
        this.wayIndex = new Map();
        this.relationIndex = new Map();
        this.reportTainted = false;
        this.polygonTags = undefined;
    }

    /** Elements in registration order. */
    public elements(): OsmObject[] {
        return this.ordered;
    }

    private indexOf(value: OsmObject): Map<any, OsmObject> | undefined {
        if (value instanceof Node) {
            return this.nodes;
        }
        if (value instanceof Way) {
            return this.wayIndex;
        }
        if (value instanceof Relation) {
            return this.relationIndex;
        }
        return undefined;
    }

    /**
     * Register an element. Ids are unique after history resolution; a repeat
     * can only come from junk entries without a usable id, and the first one
     * is kept.
     */
    public add(value: OsmObject) {
        const index = this.indexOf(value);
        if (index === undefined) {
            const key = value.getCompositeId();
            if (this.others.has(key)) {
                return;
            }
            this.others.set(key, value);
        } else {
            if (index.has(value.id)) {
                return;
            }
            index.set(value.id, value);
        }
        this.ordered.push(value);
    }

    public get(compositeId: string): OsmObject | undefined {
        const slash = compositeId.indexOf('/');
        if (slash < 0) {
            return undefined;
        }
        const type = compositeId.slice(0, slash);
        const id = compositeId.slice(slash + 1);
        if (type === 'node') {
            return RefElements.lookup(this.nodes, id);
        }
        if (type === 'way') {
            return RefElements.lookup(this.wayIndex, id);
        }
        if (type === 'relation') {
            return RefElements.lookup(this.relationIndex, id);
        }
        return this.others.get(compositeId);
    }

    public addPendingWay(way: Way) {
        this.pendingWays.add(way);
    }

    public addPendingRelation(relation: Relation) {
        this.pendingRelations.add(relation);
    }

    /** Look up an element by raw id, tolerating string/number id spellings. */
    private static lookup<T>(index: Map<any, T>, ref: any): T | undefined {
        const direct = index.get(ref);
        if (direct !== undefined) {
            return direct;
        }
        return index.get(typeof ref === 'number' ? String(ref) : Number(ref));
    }

    /** Resolve every pending way and relation reference. */
    public bindAll() {
        for (const way of this.pendingWays) {
            way.resolveNodeRefs(this.nodes);
        }
        this.pendingWays.clear();
        for (const relation of this.pendingRelations) {
            relation.resolveMembers(this.nodes, this.wayIndex, this.relationIndex);
        }
        this.pendingRelations.clear();
    }
}
