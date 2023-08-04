module.exports = (() => {
    'use strict';

    const { first, last, coordsToKey,
        addToMap, removeFromMap, getFirstFromMap,
        isRing, ringDirection, ptInsidePolygon, strToFloat,
        LateBinder, WayCollection } = require('./utils.js'),
        polygonTags = require('./polytags.json');

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
                        coordinates: strToFloat([this.latLng.lon, this.latLng.lat])
                    }
                }];
            }

            return [];
        }

        getLatLng() {
            return this.latLng;
        }
    }

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
            let binder = new LateBinder(this.latLngArray, function (id) {
                let node = this.refElems.get(`node/${id}`);
                if (node) {
                    node.refCount++;
                    return node.getLatLng();
                }
            }, this, [ref]);

            this.latLngArray.push(binder);
            this.refElems.addBinder(binder);
        }

        analyzeTag(k, v) {
            let o = polygonTags[k];
            if (o) {
                this.isPolygon = true;
                if (o.whitelist) {
                    this.isPolygon = o.whitelist.indexOf(v) >= 0 ? true : false;
                } else if (o.blacklist) {
                    this.isPolygon = o.blacklist.indexOf(v) >= 0 ? false : true;
                }
            }
        }

        addTags(tags) {
            super.addTags(tags);
            for (let [k, v] of Object.entries(tags)) {
                this.analyzeTag(k, v);
            }
        }

        addTag(k, v) {
            super.addTag(k, v);
            this.analyzeTag(k, v);
        }

        toCoordsArray() {
            return this.latLngArray.map(latLng => [latLng.lon, latLng.lat]);
        }

        toFeatureArray() {
            let coordsArray = this.toCoordsArray();
            if (coordsArray.length > 1) {
                coordsArray = strToFloat(coordsArray);
                let feature = {
                    type: 'Feature',
                    id: this.getCompositeId(),
                    properties: this.getProps(),
                    geometry: {
                        type: 'LineString',
                        coordinates: coordsArray
                    }
                };

                if (this.isPolygon && isRing(coordsArray)) {
                    if (ringDirection(coordsArray) !== 'counterclockwise') {
                        coordsArray.reverse();
                    }

                    feature.geometry = {
                        type: 'Polygon',
                        coordinates: [coordsArray]
                    };

                    return [feature];
                }

                return [feature];
            }

            return [];
        }
    }

    class Relation extends OsmObject {
        constructor(id, refElems) {
            super('relation', id, refElems);
            this.relations = [];
            this.nodes = [];
            this.bounds = null;
        }

        setBounds(bounds) {
            this.bounds = bounds;
        }

        addMember(member) {
            switch (member.type) {
                // super relation, need to do combination
                case 'relation':
                    let binder = new LateBinder(this.relations, function (id) {
                        let relation = this.refElems.get(`relation/${id}`);
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
                        let way = new Way(member.ref, this.refElems);
                        way.setLatLngArray(member.geometry);
                        way.refCount++;
                        ways.push(way);
                    } else if (member.nodes) {
                        let way = new Way(member.ref, this.refElems);
                        for (let nid of member.nodes) {
                            way.addNodeRef(nid);
                        }
                        way.refCount++;
                        ways.push(way);
                    } else {
                        let binder = new LateBinder(ways, function (id) {
                            let way = this.refElems.get(`way/${id}`);
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
                        for (let [k, v] of Object.entries(member)) {
                            if (['id', 'type', 'lat', 'lon'].indexOf(k) < 0) {
                                node.addProp(k, v);
                            }
                        }

                        node.refCount++;
                        this.nodes.push(node);
                    } else {
                        let binder = new LateBinder(this.nodes, function (id) {
                            let node = this.refElems.get(`node/${id}`);
                            if (node) {
                                node.refCount++;
                                return node;
                            }
                        }, this, [member.ref]);
                        this.nodes.push(binder);
                        this.refElems.addBinder(binder);
                    }
                    break;

                default:
                    break;
            }
        }

        toFeatureArray() {
            const constructStringGeometry = (ws) => {
                let strings = ws ? ws.toStrings() : [];
                if (strings.length > 0) {
                    if (strings.length === 1) return {
                        type: 'LineString',
                        coordinates: strings[0]
                    }

                    return {
                        type: 'MultiLineString',
                        coordinates: strings
                    }
                }
                return null;
            }

            const constructPolygonGeometry = (ows, iws) => {
                let outerRings = ows ? ows.toRings('counterclockwise') : [],
                    innerRings = iws ? iws.toRings('clockwise') : [];

                if (outerRings.length > 0) {
                    let compositPolyons = [];

                    let ring = null;
                    for (ring of outerRings)
                        compositPolyons.push([ring]);

                    // link inner polygons to outer containers
                    while (ring = innerRings.shift()) {
                        for (let idx in outerRings) {
                            if (ptInsidePolygon(first(ring), outerRings[idx])) {
                                compositPolyons[idx].push(ring);
                                break;
                            }
                        }
                    }

                    // construct the Polygon/MultiPolygon geometry
                    if (compositPolyons.length === 1) {
                        return {
                            type: 'Polygon',
                            coordinates: compositPolyons[0]
                        };
                    }

                    return {
                        type: 'MultiPolygon',
                        coordinates: compositPolyons
                    }
                }

                return null;
            }

            let polygonFeatures = [], stringFeatures = [], pointFeatures = [];
            const waysFieldNames = ['outer', 'inner', ''];
            // need to do combination when there're nested relations
            for (let relation of this.relations) {
                if (relation) {
                    for (let fieldName of waysFieldNames) {
                        let ways = relation[fieldName];
                        if (ways) {
                            let thisWays = this[fieldName];
                            if (thisWays) {
                                [].splice.apply(thisWays, [thisWays.length, 0].concat(ways));
                            } else {
                                this[fieldName] = ways;
                            }
                        }
                    }
                }
            }

            for (let fieldName of waysFieldNames) {
                let ways = this[fieldName];
                if (ways) {
                    this[fieldName] = new WayCollection();
                    for (let way of ways) {
                        this[fieldName].addWay(way);
                    }
                }
            }

            let geometry = null;

            let feature = {
                type: 'Feature',
                id: this.getCompositeId(),
                bbox: this.bounds,
                properties: this.getProps()
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

            for (let node of this.nodes) {
                pointFeatures = pointFeatures.concat(node.toFeatureArray());
            }

            return polygonFeatures.concat(stringFeatures).concat(pointFeatures);
        }
    }

    return { Node, Way, Relation };
})();