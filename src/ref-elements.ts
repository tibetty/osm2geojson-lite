import { LateBinder } from "./late-binder";
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
    private binders: LateBinder<any>[];
    private duplicates: Array<{ existing: OsmObject; duplicate: OsmObject }>;
    /** composite id -> newest version known to be deleted */
    private tombstones: Map<string, number>;

    constructor() {
        super();
        this.binders = [];
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
            this.removeBindersOwnedBy(element);
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

    public addBinder(binder: LateBinder<any>) {
        this.binders.push(binder);
    }

    /**
     * Resolve every deferred reference in one pass per container.
     *
     * The previous implementation removed each binder with `indexOf` + `splice`,
     * which is O(n^2) for containers such as a way's node list. Grouping by
     * container and compacting once keeps insertion order and makes binding
     * linear in the number of binders.
     */
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
                    this.removeBindersOwnedBy(existing);
                    this.set(existing.getCompositeId(), duplicate);
                } else {
                    this.removeBindersOwnedBy(duplicate);
                }
                continue;
            }

            const preferDuplicate = duplicateVersion > existingVersion;
            existing.mergeFrom(duplicate);

            if (duplicate instanceof Output && !(existing instanceof Output)) {
                // Derived/custom output replaces the relation placeholder.
                this.set(existing.getCompositeId(), duplicate);
                this.removeBindersOwnedBy(existing);
                continue;
            }
            if (existing instanceof Output) {
                this.removeBindersOwnedBy(duplicate);
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
                    this.removeBindersOwnedBy(existing);
                } else {
                    this.removeBindersOwnedBy(duplicate);
                }
                continue;
            }
            if (existing instanceof Relation && duplicate instanceof Relation) {
                if (existing.adoptMembersFrom(duplicate, preferDuplicate)) {
                    this.removeBindersOwnedBy(existing);
                } else {
                    this.removeBindersOwnedBy(duplicate);
                }
                continue;
            }
            this.removeBindersOwnedBy(duplicate);
        }
        this.duplicates = [];
    }

    private removeBindersOwnedBy(owner: OsmObject) {
        this.binders = this.binders.filter((binder) => binder.getOwner() !== owner);
    }

    public bindAll() {
        if (this.duplicates.length > 0) {
            this.mergeDuplicates();
        }
        this.resolveHistory();
        if (this.binders.length === 0) {
            return;
        }

        const groups = new Map<Array<any>, LateBinder<any>[]>();
        for (const binder of this.binders) {
            const container = binder.getContainer();
            const list = groups.get(container);
            if (list) {
                list.push(binder);
            } else {
                groups.set(container, [binder]);
            }
        }

        for (const [container, binders] of groups) {
            const bindersInContainer = new Set(binders);
            const resolved = new Map<LateBinder<any>, any>();
            for (const binder of binders) {
                resolved.set(binder, binder.resolve());
            }
            const roleContainer = binders[0].getRoleContainer();

            let write = 0;
            for (let read = 0; read < container.length; read++) {
                const item = container[read];
                if (bindersInContainer.has(item)) {
                    const value = resolved.get(item);
                    if (value !== undefined) {
                        container[write] = value;
                        if (roleContainer) {
                            roleContainer[write] = (item as LateBinder<any>).getRole();
                        }
                        write++;
                    }
                } else {
                    container[write] = item;
                    if (roleContainer) {
                        roleContainer[write] = roleContainer[read];
                    }
                    write++;
                }
            }
            container.length = write;
            if (roleContainer) {
                roleContainer.length = write;
            }
        }

        this.binders = [];
    }
}
