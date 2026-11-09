import { OsmObject } from "./osm-object";
import type { RefElements } from "./ref-elements";
import type { Feature } from "geojson";

export type LatLon = { lat: string | number, lon: string | number };

export class Node extends OsmObject {
    private latLng: LatLon | undefined;

    constructor(id: string, refElems: RefElements, register: boolean = true) {
        super('node', id, refElems, register);
    }

    public setLatLng(latLng: LatLon) {
        this.latLng = latLng;
    }

    public hasCoordinates(): boolean {
        const latLng = this.latLng;
        if (!latLng) {
            return false;
        }
        const lat = latLng.lat;
        const lon = latLng.lon;
        if ((typeof lat !== 'number' && typeof lat !== 'string') ||
            (typeof lon !== 'number' && typeof lon !== 'string') ||
            lat === '' || lon === '') {
            return false;
        }
        return Number.isFinite(+lat) && Number.isFinite(+lon);
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        if (this.hasCoordinates()) {
            return [{
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'Point',
                    coordinates: [+this.latLng!.lon, +this.latLng!.lat],
                },
            }];
        }
        return [];
    }

    public getLatLng(): LatLon | undefined {
        return this.latLng;
    }
}
