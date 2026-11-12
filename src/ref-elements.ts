import { Node } from "./node";
import { Output } from "./output";
import { Relation } from "./relation";
import { Way } from "./way";
import type { OsmObject } from "./osm-object";
import type { PolygonTags } from "./way";

export class RefElements extends Map<string, OsmObject> {
    /** When true, features with unresolved references expose `@tainted: true`. */
    public reportTainted: boolean;
    /** Overrides the built-in polygon tag rules when provided. */
    public polygonTags: PolygonTags | undefined;
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

    constructor() {
        super();
        this.pendingWays = new Set();
        this.pendingRelations = new Set();
        this.nodes = new Map();
        this.wayIndex = new Map();
        this.relationIndex = new Map();
        this.duplicates = [];
        this.tombstones = new Map();
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

    public add(k: string, v: OsmObject) {
        const existing = this.get(k);
        if (existing && existing !== v) {
            this.duplicates.push({ existing, duplicate: v });
            return;
        }
        this.set(k, v);
    }

    public set(key: string, value: OsmObject): this {
        if (value instanceof Node) {
            this.nodes.set(value.id, value);
        } else if (value instanceof Way) {
            this.wayIndex.set(value.id, value);
        } else if (value instanceof Relation) {
            this.relationIndex.set(value.id, value);
        }
        return super.set(key, value);
    }

    public delete(key: string): boolean {
        const existing = super.get(key);
        if (existing instanceof Node) {
            this.nodes.delete(existing.id);
        } else if (existing instanceof Way) {
            this.wayIndex.delete(existing.id);
        } else if (existing instanceof Relation) {
            this.relationIndex.delete(existing.id);
        }
        return super.delete(key);
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
            way.resolveNodeRefs((ref) => RefElements.lookup(this.nodes, ref));
        }
        this.pendingWays.clear();
    }

    private resolvePendingRelations() {
        if (this.pendingRelations.size === 0) {
            return;
        }
        for (const relation of this.pendingRelations) {
            relation.resolveMembers(
                (ref) => RefElements.lookup(this.nodes, ref),
                (ref) => RefElements.lookup(this.wayIndex, ref),
                (ref) => RefElements.lookup(this.relationIndex, ref),
            );
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
                    this.set(existing.getCompositeId(), duplicate);
                } else {
                    this.dropPendingWork(duplicate);
                }
                continue;
            }

            const preferDuplicate = duplicateVersion > existingVersion;
            existing.mergeFrom(duplicate);

            if (duplicate instanceof Output && !(existing instanceof Output)) {
                // Derived/custom output replaces the relation placeholder.
                this.set(existing.getCompositeId(), duplicate);
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
    }
}
