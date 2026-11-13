import { purgeProps } from './utils';
import { Node } from './node';
import { Way } from './way';
import { Relation } from './relation';
import { Output } from './output';
import type { RefElements } from './ref-elements';
import { resolveElementHistory } from './elements';

/**
 * Register Overpass-shaped element objects in a `RefElements` registry.
 *
 * Every format ends up here or builds the same objects directly, so this is
 * also the path `applyOsmChange` takes after merging an element-level diff —
 * the merged state is no longer a document in any one format.
 */
export function analyzeElements(osm: { [k: string]: any }, refElements: RefElements): void {
    const elements = Array.isArray(osm.elements) ? resolveElementHistory(osm.elements).elements : [];
    for (const elem of elements) {
        // Junk entries and deleted elements (history, Overpass, osmChange) must
        // not produce geometry.
        if (!elem || elem.visible === false || elem.visible === 'false' || elem.action === 'delete') {
            continue;
        }
        // Overpass derived geometries (`local`, `convert`, `make`, `out geom`)
        // may already carry a complete GeoJSON geometry object.
        if (elem.geometry && typeof elem.geometry === 'object' && elem.geometry.type) {
            const output = new Output(elem.type, elem.id, refElements);
            output.setProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'geometry', 'tainted'], { id: output.getCompositeId() }));
            if (elem.tags) {
                output.addTags(elem.tags);
            }
            if (elem.tainted === true) {
                output.tainted = true;
            }
            output.setGeometry(elem.geometry);
            continue;
        }

        switch (elem.type) {
            case 'node':
                const node = new Node(elem.id as string, refElements);
                node.setProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'lat', 'lon', 'tainted'], { id: node.getCompositeId() }));
                if (elem.tags) {
                    node.addTags(elem.tags);
                }
                node.setLatLng(elem);
                if (elem.tainted === true) {
                    node.tainted = true;
                }
                break;
            case 'way':
                const way = new Way(elem.id as string, refElements);
                way.setProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'nodes', 'geometry', 'tainted'], { id: way.getCompositeId() }));
                if (elem.tags) {
                    way.addTags(elem.tags);
                }
                if (elem.tainted === true) {
                    way.tainted = true;
                }
                if (elem.geometry) {
                    way.setLatLngArray(elem.geometry);
                } else if (elem.center) {
                    way.setCenter(elem.center);
                } else if (elem.nodes) {
                    for (const n of elem.nodes) {
                        way.addNodeRef(n);
                    }
                } else if (elem.bounds) {
                    way.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
                }
                break;
            case 'relation':
                const relation = new Relation(elem.id as string, refElements);
                if (elem.bounds) {
                    relation.setBounds([parseFloat(elem.bounds.minlon), parseFloat(elem.bounds.minlat), parseFloat(elem.bounds.maxlon), parseFloat(elem.bounds.maxlat)]);
                }
                relation.setProps(purgeProps(elem as { [k: string]: string }, ['id', 'type', 'tags', 'bounds', 'members', 'tainted'], { id: relation.getCompositeId() }));
                if (elem.tags) {
                    relation.addTags(elem.tags);
                }
                if (elem.center) {
                    relation.setCenter(elem.center);
                }
                if (elem.tainted === true) {
                    relation.tainted = true;
                }
                if (elem.members) {
                    for (const member of elem.members) {
                        relation.addMember(member);
                    }
                }
            default:
                break;
        }
    }
}
