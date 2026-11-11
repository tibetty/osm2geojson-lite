import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';

const json = (elements: any[], opts?: any) => osm2geojson({ elements }, { completeFeature: true, ...opts }) as any;
const xml = (osm: string, opts?: any) => osm2geojson(osm, { completeFeature: true, ...opts }) as any;

describe('history resolution (JSON)', () => {
    it('keeps the newest version and ignores older tags', () => {
        const result = json([
            { type: 'node', id: 1, version: 1, lat: 0, lon: 0, tags: { old: 'yes' } },
            { type: 'node', id: 1, version: 2, lat: 1, lon: 1, tags: { current: 'yes' } },
        ]);
        expect(result.features).toHaveLength(1);
        const feature = result.features[0];
        expect(feature.geometry.coordinates).toEqual([1, 1]);
        expect(feature.properties.current).toBe('yes');
        expect(feature.properties.old).toBeUndefined();
        expect(feature.properties.version).toBe(2);
    });

    it('drops an element whose newest version is deleted', () => {
        const result = json([
            { type: 'node', id: 1, version: 1, lat: 0, lon: 0 },
            { type: 'node', id: 1, version: 2, visible: false },
        ]);
        expect(result.features).toEqual([]);
    });

    it('keeps an element when only an older version was deleted', () => {
        const result = json([
            { type: 'node', id: 1, version: 1, visible: false },
            { type: 'node', id: 1, version: 2, lat: 1, lon: 2 },
        ]);
        expect(result.features).toHaveLength(1);
        expect(result.features[0].geometry.coordinates).toEqual([2, 1]);
    });

    it('still merges copies of the same version', () => {
        const result = json([
            { type: 'node', id: 1, version: 4, tags: { name: 'merged' } },
            { type: 'node', id: 1, version: 4, lat: 1, lon: 2 },
        ]);
        expect(result.features).toHaveLength(1);
        expect(result.features[0].geometry.coordinates).toEqual([2, 1]);
        expect(result.features[0].properties.name).toBe('merged');
    });

    it('taints ways that reference a deleted node', () => {
        const result = json([
            { type: 'node', id: 1, version: 1, lat: 0, lon: 0 },
            { type: 'node', id: 1, version: 2, visible: false },
            { type: 'node', id: 2, version: 1, lat: 0, lon: 1 },
            { type: 'node', id: 3, version: 1, lat: 1, lon: 1 },
            { type: 'way', id: 10, version: 1, nodes: [1, 2, 3], tags: { highway: 'path' } },
        ], { tainted: true });
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[1, 0], [1, 1]]);
        expect(way.properties['@tainted']).toBe(true);
    });

    it('does not resolve a deleted element by id', () => {
        const data = {
            elements: [
                { type: 'node', id: 1, version: 1, lat: 0, lon: 0 },
                { type: 'node', id: 1, version: 2, visible: false },
            ],
        };
        expect(osm2geojson(data, { elementId: 'node/1' })).toBeUndefined();
    });
});

describe('history resolution (XML)', () => {
    it('drops a node deleted at the newest version', () => {
        const result = xml(`<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="1" version="2" visible="false"/>
        </osm>`);
        expect(result.features).toEqual([]);
    });

    it('keeps an unversioned element unless a deletion wins', () => {
        expect(xml('<osm><node id="1" lat="1" lon="2"/></osm>').features).toHaveLength(1);
        expect(xml('<osm><node id="1" lat="1" lon="2"/><node id="1" visible="false"/></osm>').features).toEqual([]);
    });

    it('keeps the newest version when the older copy comes last', () => {
        const result = xml(`<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <node id="3" version="1" lat="1" lon="1"/>
            <way id="10" version="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="path"/></way>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
        </osm>`);
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[1, 0], [1, 1]]);
    });

    it('keeps an element that was revived by a newer version', () => {
        const result = xml(`<osm>
            <node id="1" version="1" visible="false"/>
            <node id="1" version="2" lat="1" lon="2"/>
        </osm>`);
        expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
    });

    it('uses the newest way geometry', () => {
        const result = xml(`<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <node id="3" version="1" lat="1" lon="1"/>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
            <way id="10" version="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="path"/><tag k="new" v="yes"/></way>
        </osm>`);
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[1, 0], [1, 1]]);
        expect(way.properties.new).toBe('yes');
    });

    it('uses the newest relation members', () => {
        const result = xml(`<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <node id="3" version="1" lat="0" lon="2"/>
            <node id="4" version="1" lat="0" lon="3"/>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
            <way id="11" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="path"/></way>
            <relation id="20" version="1"><member type="way" ref="10" role=""/><tag k="type" v="route"/></relation>
            <relation id="20" version="2"><member type="way" ref="11" role=""/><tag k="type" v="route"/></relation>
        </osm>`);
        const relation = result.features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry).toEqual({ type: 'MultiLineString', coordinates: [[[2, 0], [3, 0]]] });
    });

    it('taints a way whose node was deleted', () => {
        const result = xml(`<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="1" version="2" visible="false"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <node id="3" version="1" lat="1" lon="1"/>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="path"/></way>
        </osm>`, { tainted: true });
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[1, 0], [1, 1]]);
        expect(way.properties['@tainted']).toBe(true);
    });
});

describe('history resolution (osmChange)', () => {
    it('keeps a created element that is newer than its deletion', () => {
        const result = xml(`<osmChange>
            <create><node id="1" version="2" lat="1" lon="2"/></create>
            <delete><node id="1" version="1"/></delete>
        </osmChange>`);
        expect(result.features).toHaveLength(1);
        expect(result.features[0].geometry.coordinates).toEqual([2, 1]);
    });

    it('drops an element deleted at the version being modified', () => {
        const result = xml(`<osmChange>
            <modify><node id="1" version="2" lat="1" lon="2"/></modify>
            <delete><node id="1" version="2"/></delete>
        </osmChange>`);
        expect(result.features).toEqual([]);
    });
});
