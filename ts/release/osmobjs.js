"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("./utils");
const utils_2 = require("./utils");
const polytags_json_1 = require("./polytags.json");
class OsmObject {
    constructor(type, id, refElems) {
        this.type = type;
        this.id = id;
        this.refElems = refElems;
        this.tags = {};
        this.props = { id: this.getCompositeId() };
        this.refCount = 0;
        this.hasTag = false;
        if (refElems) {
            refElems.add(this.getCompositeId(), this);
        }
    }
    addTags(tags) {
        this.tags = Object.assign(this.tags, tags);
        this.hasTag = tags ? true : false;
    }
    addTag(k, v) {
        this.tags[k] = v;
        this.hasTag = k ? true : false;
    }
    addProp(k, v) {
        this.props[k] = v;
    }
    addProps(props) {
        this.props = Object.assign(this.props, props);
    }
    getCompositeId() {
        return `${this.type}/${this.id}`;
    }
    getProps() {
        return Object.assign(this.props, this.tags);
    }
    toFeatureArray() {
        return [];
    }
}
class Node extends OsmObject {
    constructor(id, refElems) {
        super('node', id, refElems);
        this.latLng = null;
    }
    setLatLng(latLng) {
        this.latLng = latLng;
    }
    toFeatureArray() {
        if (this.latLng) {
            return [{
                    type: 'Feature',
                    id: this.getCompositeId(),
                    properties: this.getProps(),
                    geometry: {
                        type: 'Point',
                        coordinates: utils_1.strToFloat([this.latLng.lon, this.latLng.lat]),
                    },
                }];
        }
        return [];
    }
    getLatLng() {
        return this.latLng;
    }
}
exports.Node = Node;
class Way extends OsmObject {
    constructor(id, refElems) {
        super('way', id, refElems);
        this.latLngArray = [];
        this.isPolygon = false;
    }
    addLatLng(latLng) {
        this.latLngArray.push(latLng);
    }
    setLatLngArray(latLngArray) {
        this.latLngArray = latLngArray;
    }
    addNodeRef(ref) {
        const binder = new utils_2.LateBinder(this.latLngArray, function (id) {
            const node = this.refElems.get(`node/${id}`);
            if (node) {
                node.refCount++;
                return node.getLatLng();
            }
        }, this, [ref]);
        this.latLngArray.push(binder);
        this.refElems.addBinder(binder);
    }
    addTags(tags) {
        super.addTags(tags);
        for (const [k, v] of Object.entries(tags)) {
            this.analyzeTag(k, v);
        }
    }
    addTag(k, v) {
        super.addTag(k, v);
        this.analyzeTag(k, v);
    }
    toCoordsArray() {
        return this.latLngArray.map((latLng) => [latLng.lon, latLng.lat]);
    }
    toFeatureArray() {
        let coordsArray = this.toCoordsArray();
        if (coordsArray.length > 1) {
            coordsArray = utils_1.strToFloat(coordsArray);
            const feature = {
                type: 'Feature',
                id: this.getCompositeId(),
                properties: this.getProps(),
                geometry: {
                    type: 'LineString',
                    coordinates: coordsArray,
                },
            };
            if (this.isPolygon && utils_1.isRing(coordsArray)) {
                if (utils_1.ringDirection(coordsArray) !== 'counterclockwise') {
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
    analyzeTag(k, v) {
        const o = polytags_json_1.default[k];
        if (o) {
            this.isPolygon = true;
            if (o.whitelist) {
                this.isPolygon = o.whitelist.indexOf(v) >= 0 ? true : false;
            }
            else if (o.blacklist) {
                this.isPolygon = o.blacklist.indexOf(v) >= 0 ? false : true;
            }
        }
    }
}
exports.Way = Way;
class Relation extends OsmObject {
    constructor(id, refElems) {
        super('relation', id, refElems);
        this.relations = [];
        this.nodes = [];
        this.bounds = undefined;
    }
    setBounds(bounds) {
        this.bounds = bounds;
    }
    addMember(member) {
        switch (member.type) {
            // super relation, need to do combination
            case 'relation':
                let binder = new utils_2.LateBinder(this.relations, function (id) {
                    const relation = this.refElems.get(`relation/${id}`);
                    if (relation) {
                        relation.refCount++;
                        return relation;
                    }
                }, this, [member.ref]);
                this.relations.push(binder);
                this.refElems.addBinder(binder);
                break;
            case 'way':
                if (!member.role) {
                    member.role = '';
                }
                let ways = this[member.role];
                if (!ways) {
                    ways = this[member.role] = [];
                }
                if (member.geometry) {
                    const way = new Way(member.ref, this.refElems);
                    way.setLatLngArray(member.geometry);
                    way.refCount++;
                    ways.push(way);
                }
                else if (member.nodes) {
                    const way = new Way(member.ref, this.refElems);
                    for (const nid of member.nodes) {
                        way.addNodeRef(nid);
                    }
                    way.refCount++;
                    ways.push(way);
                }
                else {
                    binder = new utils_2.LateBinder(ways, function (nid) {
                        const way = this.refElems.get(`way/${nid}`);
                        if (way) {
                            way.refCount++;
                            return way;
                        }
                    }, this, [member.ref]);
                    ways.push(binder);
                    this.refElems.addBinder(binder);
                }
                break;
            case 'node':
                let node = null;
                if (member.lat && member.lon) {
                    node = new Node(member.ref, this.refElems);
                    node.setLatLng({ lon: member.lon, lat: member.lat });
                    if (member.tags) {
                        node.addTags(member.tags);
                    }
                    for (const [k, v] of Object.entries(member)) {
                        if (['id', 'type', 'lat', 'lon'].indexOf(k) < 0) {
                            node.addProp(k, v);
                        }
                    }
                    node.refCount++;
                    this.nodes.push(node);
                }
                else {
                    binder = new utils_2.LateBinder(this.nodes, function (id) {
                        const nn = this.refElems.get(`node/${id}`);
                        if (nn) {
                            nn.refCount++;
                            return nn;
                        }
                    }, this, [member.ref]);
                    this.nodes.push(binder);
                    this.refElems.addBinder(binder);
                }
            default:
                break;
        }
    }
    toFeatureArray() {
        function constructStringGeometry(ws) {
            const strings = ws ? ws.toStrings() : [];
            if (strings.length > 0) {
                if (strings.length === 1) {
                    return {
                        type: 'LineString',
                        coordinates: strings[0],
                    };
                }
                return {
                    type: 'MultiLineString',
                    coordinates: strings,
                };
            }
            return null;
        }
        function constructPolygonGeometry(ows, iws) {
            const outerRings = ows ? ows.toRings('counterclockwise') : [];
            const innerRings = iws ? iws.toRings('clockwise') : [];
            if (outerRings.length > 0) {
                const compositPolyons = [];
                let ring;
                for (ring of outerRings) {
                    compositPolyons.push([ring]);
                }
                // link inner polygons to outer containers
                ring = innerRings.shift();
                while (ring) {
                    for (const idx in outerRings) {
                        if (utils_1.ptInsidePolygon(utils_1.first(ring), outerRings[idx])) {
                            compositPolyons[idx].push(ring);
                            break;
                        }
                    }
                    ring = innerRings.shift();
                }
                // construct the Polygon/MultiPolygon geometry
                if (compositPolyons.length === 1) {
                    return {
                        type: 'Polygon',
                        coordinates: compositPolyons[0],
                    };
                }
                return {
                    type: 'MultiPolygon',
                    coordinates: compositPolyons,
                };
            }
            return null;
        }
        const polygonFeatures = [];
        const stringFeatures = [];
        let pointFeatures = [];
        const waysFieldNames = ['outer', 'inner', ''];
        // need to do combination when there're nested relations
        for (const relation of this.relations) {
            if (relation) {
                for (const fieldName of waysFieldNames) {
                    const ways = relation[fieldName];
                    if (ways) {
                        const thisWays = this[fieldName];
                        if (thisWays) {
                            [].splice.apply(thisWays, [thisWays.length, 0].concat(ways));
                        }
                        else {
                            this[fieldName] = ways;
                        }
                    }
                }
            }
        }
        for (const fieldName of waysFieldNames) {
            const ways = this[fieldName];
            if (ways) {
                this[fieldName] = new utils_2.WayCollection();
                for (const way of ways) {
                    this[fieldName].addWay(way);
                }
            }
        }
        let geometry = null;
        const feature = {
            type: 'Feature',
            id: this.getCompositeId(),
            bbox: this.bounds,
            properties: this.getProps(),
            geometry: null,
        };
        if (!this.bounds) {
            delete feature.bbox;
        }
        if (this.outer) {
            geometry = constructPolygonGeometry(this.outer, this.inner);
            if (geometry) {
                feature.geometry = geometry;
                polygonFeatures.push(feature);
            }
        }
        else if (this['']) {
            geometry = constructStringGeometry(this['']);
            if (geometry) {
                feature.geometry = geometry;
                stringFeatures.push(feature);
            }
        }
        for (const node of this.nodes) {
            pointFeatures = pointFeatures.concat(node.toFeatureArray());
        }
        return [...polygonFeatures, ...stringFeatures, ...pointFeatures];
    }
}
exports.Relation = Relation;
