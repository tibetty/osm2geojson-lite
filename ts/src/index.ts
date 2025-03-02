import {Feature, FeatureCollection, GeometryObject} from 'geojson';
import {Node, Relation, Way} from './osmobjs';
import {purgeProps, RefElements} from './utils';
import XmlParser from './xmlparser';

interface IOptions {
    completeFeature?: boolean;
    allFeatures?: boolean;
    renderTagged?: boolean;
    excludeWay?: boolean;
    suppressWay?: boolean;
}

export default (osm: string | {[k: string]: any}, opts?: IOptions): FeatureCollection<GeometryObject> => {
    let completeFeature = false;
    let renderTagged = false;
    let excludeWay = true;

    const parseOpts = (os: IOptions) => {
        if (os) {
            completeFeature = os.completeFeature || os.allFeatures ? true : false;
            renderTagged = os.renderTagged ? true : false;
            const wayOpt = os.suppressWay || os.excludeWay;
            if (wayOpt !== undefined && !wayOpt) {
                excludeWay = false;
            }
        }
    };

    if (opts) {
        parseOpts(opts);
    }

    const detectFormat = (o: string | {[k: string]: any}): string => {
        if ((o as {[k: string]: any}).elements) {
            return 'json';
        }
        if (o.indexOf('<osm') >= 0) {
            return 'xml';
        }
        if (o.trim().startsWith('{')) {
            return 'json-raw';
        }
        return 'invalid';
    };

    let format = detectFormat(osm);

    const refElements = new RefElements();
    let featureArray: Feature<any, any>[] = [];

    const analyzeFeaturesFromJson = (o: string | {[k: string]: any}) => {
        for (const elem of (osm as {[k: string]: any}).elements) {
            switch (elem.type) {
                case 'node':
                    const node = new Node(elem.id as string, refElements);
                    if (elem.tags) {
                        node.addTags(elem.tags);
                    }
                    node.addProps(purgeProps(elem as {[k: string]: string}, ['id', 'type', 'tags', 'lat', 'lon']));
                    node.setLatLng(elem as {lat: string, lon: string});
                    break;

                case 'way':
                    const way = new Way(elem.id as string, refElements);
                    if (elem.tags) {
                        way.addTags(elem.tags);
                    }
                    way.addProps(purgeProps(elem as {[k: string]: string}, ['id', 'type', 'tags', 'nodes', 'geometry']));
                    if (elem.nodes) {
                        for (const n of elem.nodes) {
                            way.addNodeRef(n);
                        }
                    } else if (elem.geometry) {
                        way.setLatLngArray(elem.geometry);
                    }
                    break;

                case 'relation':
                    const relation = new Relation(elem.id as string, refElements);
                    if (elem.bounds) {
                        relation.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
                    }
                    if (elem.tags) {
                        relation.addTags(elem.tags);
                    }
                    relation.addProps(purgeProps(elem as {[k: string]: string}, ['id', 'type', 'tags', 'bounds', 'members']));
                    if (elem.members) {
                        for (const member of elem.members) {
                            relation.addMember(member);
                        }
                    }
                default:
                    break;
            }
        }
    };

    const analyzeFeaturesFromXml = (o: string | {[k: string]: any}) => {
        const xmlParser = new XmlParser({progressive: true});

        xmlParser.on('</osm.node>', (node: {[k: string]: any}) => {
            const nd = new Node(node.id, refElements);
            for (const [k, v] of Object.entries(node)) {
                if (!k.startsWith('$') && ['id', 'lon', 'lat'].indexOf(k) < 0) {
                    nd.addProp(k, v);
                }
            }
            nd.setLatLng(node as {lat: string, lon: string});
            if (node.$innerNodes) {
                for (const ind of node.$innerNodes) {
                    if (ind.$tag === 'tag') {
                        nd.addTag(ind.k, ind.v);
                    }
                }
            }
        });

        xmlParser.on('</osm.way>', (node: {[k: string]: any}) => {
            const way = new Way(node.id, refElements);
            for (const [k, v] of Object.entries(node)) {
                if (!k.startsWith('$') && ['id'].indexOf(k) < 0) {
                    way.addProp(k, v);
                }
            }
            if (node.$innerNodes) {
                for (const ind of node.$innerNodes) {
                    if (ind.$tag === 'nd') {
                        if (ind.lon && ind.lat) {
                            way.addLatLng(ind);
                        } else if (ind.ref) {
                            way.addNodeRef(ind.ref);
                        }
                    } else if (ind.$tag === 'tag') {
                        way.addTag(ind.k, ind.v);
                    }
                }
            }
        });

        xmlParser.on('<osm.relation>', (node: {[k: string]: any}) => new Relation(node.id, refElements));

        xmlParser.on('</osm.relation.member>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
            const relation = refElements.get(`relation/${parent.id}`);
            const member: {[k: string]: any} = {
                type: node.type,
                role: node.role ? node.role : '',
                ref: node.ref,
            };

            if (node.lat && node.lon) {
                member.lat = node.lat, member.lon = node.lon, member.tags = {};
                for (const [k, v] of Object.entries(node)) {
                    if (!k.startsWith('$') && ['type', 'lat', 'lon'].indexOf(k) < 0) {
                        member[k] = v;
                    }
                }
            }

            if (node.$innerNodes) {
                const geometry: any[] = [];
                const nodes: any[] = [];
                for (const ind of node.$innerNodes) {
                    if (ind.lat && ind.lon) {
                        geometry.push(ind);
                    } else if (ind.ref) {
                        nodes.push(ind.ref);
                    }
                }
                if (geometry.length > 0) {
                    member.geometry = geometry;
                } else if (nodes.length > 0) {
                    member.nodes = nodes;
                }
            }
            relation.addMember(member);
        });

        xmlParser.on('</osm.relation.bounds>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
            refElements.get(`relation/${parent.id}`).setBounds([parseFloat(node.minlon), parseFloat(node.minlat), parseFloat(node.maxlon), parseFloat(node.maxlat)]);
        });

        xmlParser.on('</osm.relation.tag>', (node: {[k: string]: any}, parent: {[k: string]: any}) => {
            refElements.get(`relation/${parent.id}`).addTag(node.k, node.v);
        });

        xmlParser.parse(o as string);
    };

    if (format === 'json-raw') {
        osm = JSON.parse(osm as string) as {[k: string]: any};
        if ((osm as {[k: string]: any}).elements) {
            format = 'json';
        } else {
            format = 'invalid';
        }
    }

    if (format === 'json') {
        analyzeFeaturesFromJson(osm);
    } else if (format === 'xml') {
        analyzeFeaturesFromXml(osm);
    }

    refElements.bindAll();

    for (const v of refElements.values()) {
        if (v.refCount <= 0 || (v.hasTag && renderTagged && !(v instanceof Way && excludeWay))) {
            const features = v.toFeatureArray();
            // return the first geometry of the first relation element
            if (v instanceof Relation && !completeFeature && features.length > 0) {
                return features[0].geometry;
            }

            featureArray = featureArray.concat(features);
        }
    }

    return {type: 'FeatureCollection', features: featureArray};
};
