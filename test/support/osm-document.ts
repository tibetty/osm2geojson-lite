/**
 * Provenance and validity rules for the synthetic test documents.
 *
 * Two layers of test data exist, and they answer different questions:
 *
 * - `test/data` holds real captures - Geofabrik extracts, osmChange diffs, OSM
 *   API history and Overpass responses. They prove the library survives
 *   documents it did not invent.
 * - the documents built inline in `test/*.test.ts` are synthetic. They pin one
 *   rule each, so a failing case names the rule that broke.
 *
 * A synthetic document is only a valid test if an OSM source could produce it.
 * Otherwise the suite locks in behaviour for input that never occurs, and a
 * later change can "fix" a case nobody can hit. `assertValidOsmDocument`
 * enforces the part of the OSM data model every source promises, and
 * `test/data.test.ts` runs the same function over the whole real corpus, so a
 * rule that rejects real data fails there instead of quietly narrowing what the
 * synthetic layer is allowed to express.
 *
 * Provenance convention: synthetic documents are constructed, not captured, so
 * they carry no citation. Where a case mirrors a real object, say so in the
 * comment and name the object (see `test/data/nested-island.json` and the
 * Baarle enclaves). A case no real object can produce is a deliberate
 * specification - that is fine - but it belongs in the comment, because a
 * reader otherwise has no way to tell the two apart.
 */

const BASE_ELEMENT_TYPES = ['node', 'way', 'relation'];
const ACTION_VALUES = ['create', 'modify', 'delete'];
const VISIBLE_VALUES = [true, false, 'true', 'false'];

/**
 * A document the test deliberately built outside the OSM data model - an
 * invalid coordinate, an unsorted bound - to check that the library rejects or
 * taints it. Structural rules still apply; value rules are skipped.
 */
export interface OsmDocumentOptions {
    outsideOsmModel?: boolean;
}

function preview(element: unknown): string {
    try {
        const text = JSON.stringify(element);
        return text === undefined ? String(element) : text.slice(0, 160);
    } catch {
        return String(element);
    }
}

function fail(source: string, index: number, message: string, element?: unknown): never {
    const where = index < 0 ? source : `${source} element ${index}`;
    throw new Error(`${where}: ${message}${element === undefined ? '' : ` - ${preview(element)}`}`);
}

/** Integers arrive as numbers from JSON and as numeric strings from XML. */
function integer(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : null;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        return Number(value);
    }
    return null;
}

function coordinate(value: unknown, limit: number): number | null {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > limit) {
        return null;
    }
    return number;
}

function checkLatLon(element: { [k: string]: any }, limitLat: number, limitLon: number, label: string, source: string, index: number, outsideOsmModel: boolean): void {
    const hasLat = element.lat !== undefined && element.lat !== null;
    const hasLon = element.lon !== undefined && element.lon !== null;
    if (hasLat !== hasLon) {
        fail(source, index, `${label}: lat and lon must appear together`, element);
    }
    if (!hasLat || outsideOsmModel) {
        return;
    }
    if (coordinate(element.lat, limitLat) === null) {
        fail(source, index, `${label}: lat ${JSON.stringify(element.lat)} is not a latitude in [-90, 90]`, element);
    }
    if (coordinate(element.lon, limitLon) === null) {
        fail(source, index, `${label}: lon ${JSON.stringify(element.lon)} is not a longitude in [-180, 180]`, element);
    }
}

function checkIds(value: unknown, label: string, source: string, index: number, element: unknown): void {
    if (!Array.isArray(value)) {
        fail(source, index, `${label} must be an array of element ids`, element);
    }
    for (const id of value) {
        if (integer(id) === null) {
            fail(source, index, `${label} contains ${JSON.stringify(id)}, which is not an integer id`, element);
        }
    }
}

function checkTags(tags: unknown, source: string, index: number, element: unknown): void {
    if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) {
        fail(source, index, 'tags must be an object', element);
    }
    for (const [key, value] of Object.entries(tags as { [k: string]: unknown })) {
        if (key === '') {
            fail(source, index, 'tags has an empty key', element);
        }
        if (typeof value !== 'string') {
            fail(source, index, `tag "${key}" has a non-string value ${JSON.stringify(value)}`, element);
        }
    }
}

function checkBounds(bounds: any, source: string, index: number, element: unknown, outsideOsmModel: boolean): void {
    if (outsideOsmModel) {
        return;
    }
    const names = ['minlat', 'minlon', 'maxlat', 'maxlon'];
    for (const name of names) {
        if (coordinate(bounds[name], name === 'minlat' || name === 'maxlat' ? 90 : 180) === null) {
            fail(source, index, `bounds.${name} is missing or out of range`, element);
        }
    }
    if (Number(bounds.minlat) > Number(bounds.maxlat) || Number(bounds.minlon) > Number(bounds.maxlon)) {
        fail(source, index, 'bounds has min greater than max', element);
    }
}

function checkMembers(members: unknown, source: string, index: number, element: unknown, outsideOsmModel: boolean): void {
    if (!Array.isArray(members)) {
        fail(source, index, 'members must be an array', element);
    }
    members.forEach((member: any, memberIndex: number) => {
        if (member === null || typeof member !== 'object') {
            fail(source, index, `member ${memberIndex} is not an object`, element);
        }
        if (!BASE_ELEMENT_TYPES.includes(member.type)) {
            fail(source, index, `member ${memberIndex} has type ${JSON.stringify(member.type)}`, element);
        }
        if (integer(member.ref) === null) {
            fail(source, index, `member ${memberIndex} has no integer ref`, element);
        }
        if (member.role !== undefined && typeof member.role !== 'string') {
            fail(source, index, `member ${memberIndex} has a non-string role`, element);
        }
        if (member.geometry !== undefined) {
            checkGeometry(member.geometry, `member ${memberIndex} geometry`, source, index, element, outsideOsmModel);
        }
        if (member.nodes !== undefined) {
            checkIds(member.nodes, `member ${memberIndex} nodes`, source, index, element);
        }
    });
}

function checkGeometry(geometry: unknown, label: string, source: string, index: number, element: unknown, outsideOsmModel: boolean): void {
    if (!Array.isArray(geometry)) {
        fail(source, index, `${label} must be an array`, element);
    }
    geometry.forEach((point: any, pointIndex: number) => {
        // `out geom` leaves a null where a member is not in the result set.
        if (point === null) {
            return;
        }
        if (typeof point !== 'object') {
            fail(source, index, `${label}[${pointIndex}] is neither an object nor null`, element);
        }
        checkLatLon(point, 90, 180, `${label}[${pointIndex}]`, source, index, outsideOsmModel);
    });
}

/**
 * Throws unless every element in `elements` is a shape an OSM source can
 * produce. `source` names the document in the failure message.
 *
 * Deliberately permissive about completeness: `out ids`, `out tags`,
 * `out center` and partial extracts legitimately omit coordinates, node
 * lists and members, so a reference that does not resolve is not an error
 * here. It is about shape, not reachability - the fuzz and property tests own
 * incomplete documents.
 */
export function assertValidOsmDocument(elements: unknown, source: string, options: OsmDocumentOptions = {}): void {
    const outsideOsmModel = options.outsideOsmModel === true;
    if (!Array.isArray(elements)) {
        fail(source, -1, 'document must be an array of elements', elements);
    }
    elements.forEach((element: any, index: number) => {
        if (element === null || typeof element !== 'object' || Array.isArray(element)) {
            fail(source, index, 'element is not an object', element);
        }
        // Overpass `make`/`convert` emit a user-defined type, so only an empty
        // type is impossible; node/way/relation are the base types.
        if (typeof element.type !== 'string' || element.type === '') {
            fail(source, index, `element type ${JSON.stringify(element.type)} is not a type name`, element);
        }
        if (integer(element.id) === null) {
            fail(source, index, `element id ${JSON.stringify(element.id)} is not an integer`, element);
        }
        if (element.version !== undefined && integer(element.version) === null) {
            fail(source, index, `version ${JSON.stringify(element.version)} is not an integer`, element);
        }
        if (element.visible !== undefined && !VISIBLE_VALUES.includes(element.visible)) {
            fail(source, index, `visible ${JSON.stringify(element.visible)} is not true/false`, element);
        }
        if (element.action !== undefined && !ACTION_VALUES.includes(element.action)) {
            fail(source, index, `action ${JSON.stringify(element.action)} is not create/modify/delete`, element);
        }
        if (element.tags !== undefined) {
            checkTags(element.tags, source, index, element);
        }
        checkLatLon(element, 90, 180, 'coordinate', source, index, outsideOsmModel);
        if (element.center !== undefined) {
            checkLatLon(element.center, 90, 180, 'center', source, index, outsideOsmModel);
        }
        if (element.bounds !== undefined) {
            checkBounds(element.bounds, source, index, element, outsideOsmModel);
        }
        if (element.nodes !== undefined) {
            checkIds(element.nodes, 'nodes', source, index, element);
        }
        if (element.members !== undefined) {
            checkMembers(element.members, source, index, element, outsideOsmModel);
        }
        if (element.geometry !== undefined) {
            // `out geom` carries a lat/lon array; a JSON feed may carry a
            // ready-made GeoJSON geometry instead. Both are supported input.
            const geojson = element.geometry;
            const carried = geojson !== null && typeof geojson === 'object' && !Array.isArray(geojson) && typeof geojson.type === 'string';
            if (!carried) {
                checkGeometry(element.geometry, 'geometry', source, index, element, outsideOsmModel);
            }
        }
    });
}
