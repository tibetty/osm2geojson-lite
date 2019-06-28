import {FeatureCollection, GeometryObject} from 'geojson';

export = osm2geojson;

declare let osm2geojson: osm2geojson.IDefault;

declare namespace osm2geojson {
    interface IOptions {
        completeFeature?: boolean;
        allFeatures?: boolean;
        renderTagged?: boolean;
        excludeWay?: boolean;
        suppressWay?: boolean;
    }

    export type IDefault = (osm: string | {[k: string]: any}, opts?: IOptions) => FeatureCollection<GeometryObject>;
}
