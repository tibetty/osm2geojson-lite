"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const osmobjs_1 = require("./osmobjs");
const utils_1 = require("./utils");
const xmlparser_1 = require("./xmlparser");
exports.default = (osm, opts) => {
    let completeFeature = false;
    let renderTagged = false;
    let excludeWay = true;
    const parseOpts = (os) => {
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
    const detectFormat = (o) => {
        if (o.elements) {
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
    const refElements = new utils_1.RefElements();
    let featureArray = [];
    const analyzeFeaturesFromJson = (o) => {
        for (const elem of osm.elements) {
            switch (elem.type) {
                case 'node':
                    const node = new osmobjs_1.Node(elem.id, refElements);
                    if (elem.tags) {
                        node.addTags(elem.tags);
                    }
                    node.addProps(utils_1.purgeProps(elem, ['id', 'type', 'tags', 'lat', 'lon']));
                    node.setLatLng(elem);
                    break;
                case 'way':
                    const way = new osmobjs_1.Way(elem.id, refElements);
                    if (elem.tags) {
                        way.addTags(elem.tags);
                    }
                    way.addProps(utils_1.purgeProps(elem, ['id', 'type', 'tags', 'nodes', 'geometry']));
                    if (elem.nodes) {
                        for (const n of elem.nodes) {
                            way.addNodeRef(n);
                        }
                    }
                    else if (elem.geometry) {
                        way.setLatLngArray(elem.geometry);
                    }
                    break;
                case 'relation':
                    const relation = new osmobjs_1.Relation(elem.id, refElements);
                    if (elem.bounds) {
                        relation.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
                    }
                    if (elem.tags) {
                        relation.addTags(elem.tags);
                    }
                    relation.addProps(utils_1.purgeProps(elem, ['id', 'type', 'tags', 'bounds', 'members']));
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
    const analyzeFeaturesFromXml = (o) => {
        const xmlParser = new xmlparser_1.default({ progressive: true });
        xmlParser.on('</osm.node>', (node) => {
            const nd = new osmobjs_1.Node(node.id, refElements);
            for (const [k, v] of Object.entries(node)) {
                if (!k.startsWith('$') && ['id', 'lon', 'lat'].indexOf(k) < 0) {
                    nd.addProp(k, v);
                }
            }
            nd.setLatLng(node);
            if (node.$innerNodes) {
                for (const ind of node.$innerNodes) {
                    if (ind.$tag === 'tag') {
                        nd.addTag(ind.k, ind.v);
                    }
                }
            }
        });
        xmlParser.on('</osm.way>', (node) => {
            const way = new osmobjs_1.Way(node.id, refElements);
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
                        }
                        else if (ind.ref) {
                            way.addNodeRef(ind.ref);
                        }
                    }
                    else if (ind.$tag === 'tag') {
                        way.addTag(ind.k, ind.v);
                    }
                }
            }
        });
        xmlParser.on('<osm.relation>', (node) => new osmobjs_1.Relation(node.id, refElements));
        xmlParser.on('</osm.relation.member>', (node, parent) => {
            const relation = refElements.get(`relation/${parent.id}`);
            const member = {
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
                const geometry = [];
                const nodes = [];
                for (const ind of node.$innerNodes) {
                    if (ind.lat && ind.lon) {
                        geometry.push(ind);
                    }
                    else if (ind.ref) {
                        nodes.push(ind.ref);
                    }
                }
                if (geometry.length > 0) {
                    member.geometry = geometry;
                }
                else if (nodes.length > 0) {
                    member.nodes = nodes;
                }
            }
            relation.addMember(member);
        });
        xmlParser.on('</osm.relation.bounds>', (node, parent) => {
            refElements.get(`relation/${parent.id}`).setBounds([parseFloat(node.minlon), parseFloat(node.minlat), parseFloat(node.maxlon), parseFloat(node.maxlat)]);
        });
        xmlParser.on('</osm.relation.tag>', (node, parent) => {
            refElements.get(`relation/${parent.id}`).addTag(node.k, node.v);
        });
        xmlParser.parse(o);
    };
    if (format === 'json-raw') {
        osm = JSON.parse(osm);
        if (osm.elements) {
            format = 'json';
        }
        else {
            format = 'invalid';
        }
    }
    if (format === 'json') {
        analyzeFeaturesFromJson(osm);
    }
    else if (format === 'xml') {
        analyzeFeaturesFromXml(osm);
    }
    refElements.bindAll();
    for (const v of refElements.values()) {
        if (v.refCount <= 0 || (v.hasTag && renderTagged && !(v instanceof osmobjs_1.Way && excludeWay))) {
            const features = v.toFeatureArray();
            // return the first geometry of the first relation element
            if (v instanceof osmobjs_1.Relation && !completeFeature && features.length > 0) {
                return features[0].geometry;
            }
            featureArray = featureArray.concat(features);
        }
    }
    return { type: 'FeatureCollection', features: featureArray };
};
