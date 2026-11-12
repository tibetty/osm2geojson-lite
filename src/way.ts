import { Feature } from "geojson";
import { OsmObject } from "./osm-object";
import { LatLon, Node } from "./node";
import { boundsToRing, isFiniteBounds, isFiniteCoordinate, isRing, ringDirection } from "./utils";
import polygonTags from './polytags.json';
import type { RefElements } from "./ref-elements";

export type PolygonRule = {
    ignore?: string[];
    include?: string[];
    exclude?: string[];
    // legacy spellings kept for backwards compatibility with older polytags files
    whitelist?: string[];
    blacklist?: string[];
};

export type PolygonTags = Record<string, PolygonRule>;

const defaultPolygonRules = polygonTags as PolygonTags;

export class Way extends OsmObject {
    /** Coordinates, or still-unresolved node references, in document order. */
    private latLngArray: Array<LatLon | string | number>;
    private center: LatLon | null;
    private bounds: number[] | null;

    constructor(id: string, refElems: RefElements, register: boolean = true) {
        super('way', id, refElems, register);
        this.latLngArray = [];
        this.center = null;
        this.bounds = null;
    }

    public addLatLng(latLng: LatLon) {
        this.latLngArray.push(latLng);
    }

    public setLatLngArray(latLngArray: Array<LatLon & { [k: string]: any }>) {
        this.latLngArray = latLngArray;
    }

    public setCenter(center: LatLon) {
        if (isFiniteCoordinate(center.lat, center.lon)) {
            this.center = center;
        } else {
            this.tainted = true;
        }
    }

    public setBounds(bounds: number[]) {
        if (isFiniteBounds(bounds)) {
            this.bounds = bounds;
        } else {
            this.tainted = true;
        }
    }

    public getBounds(): number[] | null {
        return this.bounds;
    }

    /**
     * Adopt the other copy's geometry when this copy has none. Returns true
     * when the other copy's coordinate array was adopted, so its deferred
     * binders must be kept.
     */
    public adoptCoordinatesFrom(other: Way, preferOther: boolean): boolean {
        if (this.center === null && other.center) {
            this.center = other.center;
        }
        if (this.bounds === null && other.bounds) {
            this.bounds = other.bounds;
        }
        const takeOther = other.latLngArray.length > 0 && (preferOther || this.latLngArray.length === 0);
        if (takeOther) {
            this.latLngArray = other.latLngArray;
            return true;
        }
        return false;
    }

    /**
     * Record a node reference. The reference is resolved in bulk when
     * references are bound, instead of allocating one binder object and closure
     * per reference — a way-heavy extract has tens of thousands of these.
     */
    public addNodeRef(ref: string | number) {
        this.latLngArray.push(ref);
        this.refElems.addPendingWay(this);
    }

    /**
     * Replace node references by coordinates, dropping the ones that cannot be
     * resolved and marking the way tainted. Called once from `RefElements`.
     */
    public resolveNodeRefs(nodes: Map<any, Node>) {
        const source = this.latLngArray;
        let write = 0;
        for (let read = 0; read < source.length; read++) {
            const entry = source[read];
            if (typeof entry === 'string' || typeof entry === 'number') {
                let node = nodes.get(entry);
                if (node === undefined) {
                    // Ids arrive as strings from XML and numbers from PBF.
                    node = nodes.get(typeof entry === 'number' ? String(entry) : Number(entry));
                }
                if (node && node.hasCoordinates()) {
                    node.refCount++;
                    source[write++] = node.getLatLng()!;
                } else {
                    this.tainted = true;
                }
                continue;
            }
            source[write++] = entry;
        }
        source.length = write;
    }

    /**
     * Coordinates are normalised to numbers in a single pass here. Previously
     * the strings were joined for map keys and parsed again during output, so
     * every coordinate was converted twice and several intermediate arrays
     * were allocated. Missing coordinates (Overpass writes `null` for missing
     * `out geom` nodes) are skipped and mark the way as tainted.
     */
    public toCoordsArray(): number[][] {
        const source = this.latLngArray as unknown as Array<LatLon | null | undefined>;
        const coords: number[][] = new Array(source.length);
        let at = 0;
        for (let i = 0; i < source.length; i++) {
            const latLng = source[i];
            if (!latLng) {
                this.tainted = true;
                continue;
            }
            const lat = latLng.lat;
            const lon = latLng.lon;
            if ((typeof lat !== 'number' && typeof lat !== 'string') ||
                (typeof lon !== 'number' && typeof lon !== 'string') ||
                lat === '' || lon === '') {
                this.tainted = true;
                continue;
            }
            const x = +lon;
            const y = +lat;
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                this.tainted = true;
                continue;
            }
            coords[at++] = [x, y];
        }
        coords.length = at;
        return coords;
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        const coordsArray = this.toCoordsArray();
        if (coordsArray.length > 1) {
            const feature: Feature<any, any> = {
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'LineString',
                    coordinates: coordsArray,
                },
            };

            if (isRing(coordsArray) && this.isPolygon()) {
                if (ringDirection(coordsArray) !== 'counterclockwise') {
                    coordsArray.reverse();
                }

                feature.geometry = {
                    type: 'Polygon',
                    coordinates: [coordsArray],
                };
            }

            return [feature];
        }

        if (this.bounds) {
            return [{
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'Polygon',
                    coordinates: [boundsToRing(this.bounds)],
                },
            }];
        }

        if (this.center) {
            return [{
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'Point',
                    coordinates: [+this.center.lon, +this.center.lat],
                },
            }];
        }

        return [];
    }

    /**
     * Polygon detection is order-independent: a closed way is an area when at
     * least one polygon tag applies, while tags such as `building=no` or
     * `area=no` explicitly opt out.
     */
    private isPolygon(): boolean {
        const polygonRules = (this.refElems && this.refElems.polygonTags) || defaultPolygonRules;
        let area = false;
        for (const key in polygonRules) {
            const value = this.tags[key];
            if (!value) {
                continue;
            }
            const rule = polygonRules[key];
            if (rule.ignore && rule.ignore.indexOf(value) >= 0) {
                continue;
            }
            area = true;
            if (rule.include) {
                area = rule.include.indexOf(value) >= 0;
            } else if (rule.exclude) {
                area = rule.exclude.indexOf(value) < 0;
            } else if (rule.whitelist) {
                area = rule.whitelist.indexOf(value) >= 0;
            } else if (rule.blacklist) {
                area = rule.blacklist.indexOf(value) < 0;
            }
        }
        return area;
    }
}
