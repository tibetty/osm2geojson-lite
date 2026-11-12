import { Node } from "./node";
import { Output } from "./output";
import { Relation } from "./relation";
import { Way } from "./way";
import type { OsmObject } from "./osm-object";
import type { PolygonTags } from "./way";

export class RefElements {
    /** When true, features with unresolved references expose `@tainted: true`. */
    public reportTainted: boolean;
    /** Overrides the built-in polygon tag rules when provided. */
    public polygonTags: PolygonTags | undefined;

    /**
     * Elements in registration order, which is the output order. Removals leave
     * a hole that `compact()` closes, so iteration stays a plain array walk
     * instead of a map lookup per element.
     */
    private ordered: Array<OsmObject | undefined>;
    /** Other element types (Overpass `convert`, `make`, custom tags). */
    private others: Map<string, OsmObject>;
    /** Ways holding unresolved node references, resolved in one pass. */
    private pendingWays: Set<Way>;
    /** Relations holding unresolved member references. */
    private pendingRelations: Set<Relation>;
    /**
     * Nodes indexed by their raw id, so resolving a way reference does not have
     * to build a `node/<id>` string for every one of them. Kept in sync with
     * the composite map by overriding `set`/`delete`.
     */
    private nodes: Map<any, Node>;
    private wayIndex: Map<any, Way>;
    private relationIndex: Map<any, Relation>;
    private duplicates: Array<{ existing: OsmObject; duplicate: OsmObject }>;
    /** composite id -> newest version known to be deleted */
    private tombstones: Map<string, number>;
    private hasHoles: boolean;

    constructor() {
        this.ordered = [];
        this.others = new Map();
        this.pendingWays = new Set();
        this.pendingRelations = new Set();
        this.nodes = new Map();
        this.wayIndex = new Map();
        this.relationIndex = new Map();
        this.duplicates = [];
        this.tombstones = new Map();
        this.hasHoles = false;
        this.reportTainted = false;
        this.polygonTags = undefined;
    }

    /**
     * Record that an element was deleted at `version` (`visible=false`, an
     * osmChange `<delete>` section or `action="delete"`). History resolution
     * removes the surviving copy so a deleted element never yields geometry
     * and references to it stay unresolved (and therefore tainted).
     */
    public markDeleted(compositeId: string, version: number) {
        const known = this.tombstones.get(compositeId);
        if (known === undefined || version > known) {
            this.tombstones.set(compositeId, version);
        }
    }

    private resolveHistory() {
        if (this.tombstones.size === 0) {
            return;
        }
        for (const [compositeId, version] of this.tombstones) {
            const element = this.get(compositeId);
            // An unversioned tombstone counts as version 0, so it only removes
            // an element that carries no version either: a deletion never
            // overrides a newer state, which keeps XML and JSON consistent.
            if (!element || element.getVersion() > version) {
                continue;
            }
            this.dropPendingWork(element);
            this.delete(compositeId);
        }
        this.tombstones.clear();
    }

    /** Elements in registration order (holes already compacted). */
    public elements(): OsmObject[] {
        return this.ordered as OsmObject[];
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

    public add(value: OsmObject) {
        const index = this.indexOf(value);
        if (index === undefined) {
            const key = value.getCompositeId();
            const existing = this.others.get(key);
            if (existing !== undefined) {
                if (existing !== value) {
                    this.duplicates.push({ existing, duplicate: value });
                }
                return;
            }
            value.orderIndex = this.ordered.length;
            this.ordered.push(value);
            this.others.set(key, value);
            return;
        }

        const existing = index.get(value.id);
        if (existing !== undefined) {
            if (existing !== value) {
                this.duplicates.push({ existing, duplicate: value });
            }
            return;
        }
        value.orderIndex = this.ordered.length;
        this.ordered.push(value);
        index.set(value.id, value);
    }

    /** Put `replacement` where `existing` was registered, keeping the order. */
    public replace(existing: OsmObject, replacement: OsmObject) {
        replacement.orderIndex = existing.orderIndex;
        this.ordered[existing.orderIndex] = replacement;
        this.indexOf(replacement)!.set(replacement.id, replacement);
    }

    private remove(element: OsmObject) {
        const index = this.indexOf(element);
        if (index === undefined) {
            this.others.delete(element.getCompositeId());
        } else {
            index.delete(element.id);
        }
        this.ordered[element.orderIndex] = undefined;
        this.hasHoles = true;
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

    public delete(compositeId: string): boolean {
        const element = this.get(compositeId);
        if (element === undefined) {
            return false;
        }
        this.remove(element);
        return true;
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

    private resolvePendingWays() {
        if (this.pendingWays.size === 0) {
            return;
        }
        for (const way of this.pendingWays) {
            way.resolveNodeRefs(this.nodes);
        }
        this.pendingWays.clear();
    }

    private resolvePendingRelations() {
        if (this.pendingRelations.size === 0) {
            return;
        }
        for (const relation of this.pendingRelations) {
            relation.resolveMembers(this.nodes, this.wayIndex, this.relationIndex);
        }
        this.pendingRelations.clear();
    }

    /**
     * Merge duplicate element registrations before resolving references.
     *
     * Overpass unions can return the same element twice (for example once with
     * tags and once with geometry). Keeping the first object preserves map
     * insertion order; the duplicate only fills in missing data.
     */
    private mergeDuplicates() {
        for (const { existing, duplicate } of this.duplicates) {
            const existingVersion = existing.getVersion();
            const duplicateVersion = duplicate.getVersion();

            // History extracts carry several versions of the same element: the
            // newest version defines it and older copies must not contribute
            // tags or geometry. Copies without a version are treated as
            // incomplete duplicates and still merged.
            if (existingVersion > 0 && duplicateVersion > 0 && existingVersion !== duplicateVersion) {
                if (duplicateVersion > existingVersion) {
                    this.dropPendingWork(existing);
                    this.replace(existing, duplicate);
                } else {
                    this.dropPendingWork(duplicate);
                }
                continue;
            }

            const preferDuplicate = duplicateVersion > existingVersion;
            existing.mergeFrom(duplicate);

            if (duplicate instanceof Output && !(existing instanceof Output)) {
                // Derived/custom output replaces the relation placeholder.
                this.replace(existing, duplicate);
                this.dropPendingWork(existing);
                continue;
            }
            if (existing instanceof Output) {
                this.dropPendingWork(duplicate);
                continue;
            }
            if (existing instanceof Node && duplicate instanceof Node) {
                if (duplicate.hasCoordinates() && (!existing.hasCoordinates() || preferDuplicate)) {
                    existing.setLatLng(duplicate.getLatLng()!);
                }
                continue;
            }
            if (existing instanceof Way && duplicate instanceof Way) {
                if (existing.adoptCoordinatesFrom(duplicate, preferDuplicate)) {
                    this.dropPendingWork(existing);
                } else {
                    this.dropPendingWork(duplicate);
                }
                continue;
            }
            if (existing instanceof Relation && duplicate instanceof Relation) {
                if (existing.adoptMembersFrom(duplicate, preferDuplicate)) {
                    this.dropPendingWork(existing);
                } else {
                    this.dropPendingWork(duplicate);
                }
                continue;
            }
            this.dropPendingWork(duplicate);
        }
        this.duplicates = [];
    }

    /** A discarded duplicate must not resolve its references. */
    private dropPendingWork(owner: OsmObject) {
        this.pendingWays.delete(owner as Way);
        this.pendingRelations.delete(owner as Relation);
    }

    public bindAll() {
        if (this.duplicates.length > 0) {
            this.mergeDuplicates();
        }
        this.resolveHistory();
        this.resolvePendingWays();
        this.resolvePendingRelations();
        if (this.hasHoles) {
            this.ordered = this.ordered.filter((element) => element !== undefined);
            this.ordered.forEach((element, position) => {
                element!.orderIndex = position;
            });
            this.hasHoles = false;
        }
    }
}
