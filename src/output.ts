import { OsmObject } from "./osm-object";
import type { Feature, GeometryObject } from "geojson";
import type { RefElements } from "./ref-elements";

/**
 * A pre-built geometry carried by Overpass derived responses (`out geom`,
 * `convert`, `make`, `local`) or by equivalent XML output.
 */
export class Output extends OsmObject {
    private geometry: GeometryObject | undefined;

    constructor(type: string, id: string, refElems: RefElements) {
        super(type, id, refElems);
    }

    public setGeometry(geometry: GeometryObject) {
        this.geometry = geometry;
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        if (!this.geometry) {
            return [];
        }
        return [{
            type: 'Feature',
            id: this.getCompositeId(),
            properties: this.getProps(),
            geometry: this.geometry,
        }];
    }
}
