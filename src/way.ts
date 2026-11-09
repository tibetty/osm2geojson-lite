import { Feature } from "geojson";
import { OsmObject } from "./osm-object";
import { LatLon, Node } from "./node";
import { LateBinder } from "./late-binder";
import { isRing, ringDirection } from "./utils";
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
    private latLngArray: Array<LatLon | LateBinder<LatLon>>;
    private center: LatLon | null;

    constructor(id: string, refElems: RefElements, register: boolean = true) {
        super('way', id, refElems, register);
        this.latLngArray = [];
        this.center = null;
    }

    public addLatLng(latLng: LatLon) {
        this.latLngArray.push(latLng);
    }

    public setLatLngArray(latLngArray: Array<LatLon & { [k: string]: any }>) {
        this.latLngArray = latLngArray;
    }

    public setCenter(center: LatLon) {
        this.center = center;
    }

    public addNodeRef(ref: string) {
        const binder = new LateBinder(this.latLngArray, (id: string) => {
            const node = this.refElems.get(`node/${id}`) as Node;
            if (node) {
                node.refCount++;
                return node.getLatLng();
            }
            this.tainted = true;
        }, this, [ref]);

        this.latLngArray.push(binder);
        this.refElems.addBinder(binder);
    }

    /**
     * Coordinates are normalised to numbers in a single pass here. Previously
     * the strings were joined for map keys and parsed again during output, so
     * every coordinate was converted twice and several intermediate arrays
     * were allocated.
     */
    public toCoordsArray(): number[][] {
        const source = this.latLngArray as LatLon[];
        const coords: number[][] = new Array(source.length);
        for (let i = 0; i < source.length; i++) {
            const latLng = source[i];
            coords[i] = [+latLng.lon, +latLng.lat];
        }
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
