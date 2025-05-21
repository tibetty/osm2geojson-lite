import { OsmObject } from "./osm-object";
import { strArrayToFloat } from "./utils";
import type { RefElements } from "./ref-elements";
import type { Feature } from "geojson";

export type LatLon = { lat: string, lon: string };

export class Node extends OsmObject {
    private latLng: LatLon | undefined;

    constructor(id: string, refElems: RefElements) {
        super('node', id, refElems);
    }

    public setLatLng(latLng: LatLon) {
        this.latLng = latLng;
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        if (this.latLng) {
            return [{
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'Point',
                    coordinates: strArrayToFloat([this.latLng.lon, this.latLng.lat]),
                },
            }];
        }
        return [];
    }

    public getLatLng(): LatLon | undefined {
        return this.latLng;
    }
}