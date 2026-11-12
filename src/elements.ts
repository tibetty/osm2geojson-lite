/**
 * Element-level handling: collapse duplicate/multi-version copies and apply an
 * osmChange to a base document.
 *
 * Everything here works on the Overpass JSON element shape, so XML, JSON and
 * PBF input share one merge implementation: parse each document to elements,
 * resolve it, then merge two resolved documents.
 */

export interface MergeConflict {
    /** Composite id, e.g. `node/123`. */
    id: string;
    /** Version carried by the change entry. */
    changeVersion: number;
    /** Version the base already has. */
    baseVersion: number;
}

export interface MergedDocument {
    elements: any[];
    conflicts: MergeConflict[];
}

export interface ResolvedDocument {
    elements: any[];
    /** Elements deleted at their newest version: composite id -> version. */
    deleted: Map<string, number>;
}

function elementKey(elem: { [k: string]: any }): string {
    return `${elem.type}/${elem.id}`;
}

function elementVersion(elem: { [k: string]: any }): number {
    return Number(elem.version) || 0;
}

function elementRank(elem: { [k: string]: any }): [number, number] {
    return [elementVersion(elem), Object.keys(elem).length];
}

function isDeletedElement(elem: { [k: string]: any }): boolean {
    return elem.visible === false || elem.visible === 'false' || elem.action === 'delete';
}

/**
 * Merge copies of the same element that share a version. Overpass unions can
 * return an element twice (once as a skeleton, once with geometry), so the
 * most complete copy wins while missing tags and fields are filled in.
 */
function mergeCopies(copies: any[]): any {
    let merged = copies[0];
    for (let i = 1; i < copies.length; i++) {
        const elem = copies[i];
        const winner = elementRank(elem) > elementRank(merged) ? elem : merged;
        const loser = winner === elem ? merged : elem;
        const next: { [k: string]: any } = { ...loser, ...winner };
        if (winner.tags || loser.tags) {
            next.tags = { ...(loser.tags || {}), ...(winner.tags || {}) };
        }
        merged = next;
    }
    return merged;
}

/**
 * Collapse duplicate elements.
 *
 * Overpass unions repeat the same element within one version; history extracts
 * (`.osh`, `[adiff]`, `out meta`) repeat it across versions. Copies of one
 * version are merged into the most complete one, while the newest version wins
 * outright. A newest version that is deleted is reported and dropped.
 */
export function resolveElementHistory(elements: any[]): ResolvedDocument {
    // Fast path: a document whose ids are already unique and which contains no
    // deletion is resolved as-is. The scan uses raw ids per type, so it costs no
    // key strings; building them for 48k elements was the bulk of this call.
    const seenByType = new Map<string, Set<any>>();
    let needsWork = false;
    for (const elem of elements) {
        if (!elem || elem.type === undefined || elem.id === undefined
            || elem.visible === false || elem.visible === 'false' || elem.action === 'delete') {
            needsWork = true;
            break;
        }
        let ids = seenByType.get(elem.type);
        if (ids === undefined) {
            ids = new Set();
            seenByType.set(elem.type, ids);
        }
        if (ids.has(elem.id)) {
            needsWork = true;
            break;
        }
        ids.add(elem.id);
    }
    if (!needsWork) {
        return { elements, deleted: new Map() };
    }

    // One element in, one element out: only ids that actually repeat need an
    // array, so a plain extract allocates no per-element containers.
    const groups = new Map<string, any | any[]>();
    const order: string[] = [];
    const extra: any[] = [];
    const deleted = new Map<string, number>();

    for (const elem of elements) {
        if (!elem || elem.type === undefined || elem.id === undefined) {
            extra.push(elem);
            continue;
        }
        const key = elementKey(elem);
        const existing = groups.get(key);
        if (existing === undefined) {
            groups.set(key, elem);
            order.push(key);
        } else if (Array.isArray(existing)) {
            existing.push(elem);
        } else {
            groups.set(key, [existing, elem]);
        }
    }

    const resolved = [...extra];
    for (const key of order) {
        const entry = groups.get(key)!;
        if (!Array.isArray(entry)) {
            if (isDeletedElement(entry)) {
                deleted.set(key, elementVersion(entry));
            } else {
                resolved.push(entry);
            }
            continue;
        }
        const group = entry as any[];
        let newest = group[0];
        let newestVersion = 0;
        for (const elem of group) {
            if (elementRank(elem) > elementRank(newest)) {
                newest = elem;
            }
            const version = elementVersion(elem);
            if (version > newestVersion) {
                newestVersion = version;
            }
        }

        if (isDeletedElement(newest)) {
            deleted.set(key, newestVersion);
            continue;
        }

        // Copies without a version are incomplete duplicates rather than an
        // older state, so they still contribute to the newest version.
        const survivors = group.filter((elem) => {
            if (isDeletedElement(elem)) {
                return false;
            }
            const version = elementVersion(elem);
            return version === 0 || version === newestVersion;
        });
        resolved.push(survivors.length === 1 ? survivors[0] : mergeCopies(survivors));
    }

    return { elements: resolved, deleted };
}

function reportConflict(conflicts: MergeConflict[], strict: boolean, id: string, changeVersion: number, baseVersion: number): void {
    conflicts.push({ id, changeVersion, baseVersion });
    if (strict) {
        throw new Error(`stale osmChange entry for ${id}: version ${changeVersion} does not advance base version ${baseVersion}`);
    }
}

/**
 * Apply resolved change entries to resolved base elements.
 *
 * A change only overrides what it advances: an entry whose version is not
 * newer than the base copy leaves the base intact and is reported as a
 * conflict, so a mismatched extract/diff pair cannot roll data back. Deletions
 * are the exception: an osmChange delete names the version being deleted, so a
 * delete applies when the base is at or below that version. Elements absent
 * from the base are creates and are appended in document order.
 */
export function mergeResolved(base: ResolvedDocument, change: ResolvedDocument, strict: boolean = false): MergedDocument {
    const replacements = new Map<string, any>();
    for (const elem of change.elements) {
        replacements.set(elementKey(elem), elem);
    }

    const conflicts: MergeConflict[] = [];
    const elements: any[] = [];

    for (const elem of base.elements) {
        const key = elementKey(elem);
        const baseVersion = elementVersion(elem);

        const replacement = replacements.get(key);
        if (replacement) {
            const changeVersion = elementVersion(replacement);
            // The id exists in the base, so the entry is a replacement either
            // way: applied, or stale and dropped. Leaving it in `replacements`
            // would append it again as a create and duplicate the element.
            replacements.delete(key);
            if (changeVersion !== 0 && changeVersion <= baseVersion) {
                reportConflict(conflicts, strict, key, changeVersion, baseVersion);
                elements.push(elem);
            } else {
                elements.push(replacement);
            }
            continue;
        }

        const deletionVersion = change.deleted.get(key);
        if (deletionVersion !== undefined) {
            // An osmChange delete carries the version being deleted, not a new
            // one: equality is the normal case. The base only wins when it has
            // already moved past that version.
            if (deletionVersion !== 0 && baseVersion > deletionVersion) {
                reportConflict(conflicts, strict, key, deletionVersion, baseVersion);
                elements.push(elem);
            }
            // Otherwise the element is deleted: leave it out.
            continue;
        }

        elements.push(elem);
    }

    for (const elem of change.elements) {
        if (replacements.has(elementKey(elem))) {
            elements.push(elem);
        }
    }

    return { elements, conflicts };
}
