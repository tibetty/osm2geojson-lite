import { Feature } from "geojson";
import { OsmObject } from "./osm-object";
import { Node } from "./node";
import { LateBinder } from "./late-binder";
import { isRing, ringDirection, strArrayArrayToFloat } from "./utils";
import polygonTags from './polytags.json';
import type { RefElements } from "./ref-elements";


export class Way extends OsmObject {
    private latLngArray: Array<{ lon: string, lat: string } | LateBinder>;
    private isPolygon: boolean;

    constructor(id: string, refElems: RefElements) {
        super('way', id, refElems);
        this.latLngArray = [];
        this.isPolygon = false;
    }

    public addLatLng(latLng: { lat: string, lon: string }) {
        this.latLngArray.push(latLng);
    }

    public setLatLngArray(latLngArray: Array<{ lat: string, lon: string, [k: string]: any }>) {
        this.latLngArray = latLngArray;
    }

    public addNodeRef(ref: string) {
        const binder = new LateBinder(this.latLngArray, (id: string) => {
            const node = this.refElems.get(`node/${id}`) as Node;
            if (node) {
                node.refCount++;
                return node.getLatLng();
            }
        }, this, [ref]);

        this.latLngArray.push(binder);
        this.refElems.addBinder(binder);
    }

    public addTags(tags: { [k: string]: string }) {
        super.addTags(tags);
        for (const [k, v] of Object.entries(tags)) {
            this.analyzeTag(k, v);
        }
    }

    public addTag(k: string, v: string) {
        super.addTag(k, v);
        this.analyzeTag(k, v);
    }

    public toCoordsArray(): string[][] {
        return (this.latLngArray as Array<{ lon: string, lat: string }>).map((latLng) => [latLng.lon, latLng.lat]);
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        let coordsArrayString = this.toCoordsArray();
        if (coordsArrayString.length > 1) {
            const coordsArray = strArrayArrayToFloat(coordsArrayString);
            const feature: Feature<any, any> = {
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'LineString',
                    coordinates: coordsArray,
                },
            };

            if (this.isPolygon && isRing(coordsArray)) {
                if (ringDirection(coordsArray) !== 'counterclockwise') {
                    coordsArray.reverse();
                }

                feature.geometry = {
                    type: 'Polygon',
                    coordinates: [coordsArray],
                };

                return [feature];
            }

            return [feature];
        }

        return [];
    }

    private analyzeTag(k: string, v: string) {
        const o = (polygonTags as Record<string, { whitelist?: string[], blacklist?: string[] } >)[k];
        if (o) {
            this.isPolygon = true;
            if (o.whitelist) {
                this.isPolygon = o.whitelist.indexOf(v) >= 0 ? true : false;
            } else if (o.blacklist) {
                this.isPolygon = o.blacklist.indexOf(v) >= 0 ? false : true;
            }
        }
    }
}