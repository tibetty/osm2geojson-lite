import {FeatureCollection, GeometryObject} from 'geojson';

export = osm2geojson;
export as namespace osm2geojson;

declare var osm2geojson: osm2geojson.Default;

declare namespace osm2geojson {
    interface Options {
        completeFeature?: boolean;
        allFeatures?: boolean;
        renderTagged?: boolean;
        suppressWay?: boolean;
    }

    export interface Default {
        // tslint:disable-next-line:no-any
        (osm: string | {[k: string]: any}, opts?: Options): FeatureCollection<GeometryObject>;
    }
}
