import { OsmObject } from "./osm-object";
import { RefElements, strToFloat } from "./utils";
import type { Feature } from "geojson";

export class Node extends OsmObject {
    private latLng: { lon: string, lat: string } | null;

    constructor(id: string, refElems: RefElements) {
        super('node', id, refElems);
        this.latLng = null;
    }

    public setLatLng(latLng: { lat: string, lon: string }) {
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
                    coordinates: strToFloat([this.latLng.lon, this.latLng.lat]),
                },
            }];
        }
        return [];
    }

    public getLatLng(): { lat: string, lon: string } | null {
        return this.latLng;
    }
}