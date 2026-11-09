import { LateBinder } from "./late-binder";
import type { OsmObject } from "./osm-object";
import type { PolygonTags } from "./way";

export class RefElements extends Map<string, OsmObject> {
    /** When true, features with unresolved references expose `@tainted: true`. */
    public reportTainted: boolean;
    /** Overrides the built-in polygon tag rules when provided. */
    public polygonTags: PolygonTags | undefined;

    private binders: LateBinder<any>[];

    constructor() {
        super();
        this.binders = [];
        this.reportTainted = false;
        this.polygonTags = undefined;
    }

    public add(k: string, v: OsmObject) {
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
    public bindAll() {
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

            let write = 0;
            for (let read = 0; read < container.length; read++) {
                const item = container[read];
                if (bindersInContainer.has(item)) {
                    const value = resolved.get(item);
                    if (value !== undefined) {
                        container[write++] = value;
                    }
                } else {
                    container[write++] = item;
                }
            }
            container.length = write;
        }

        this.binders = [];
    }
}
