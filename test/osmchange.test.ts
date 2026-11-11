import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';

const convert = (osm: any, opts?: any) => osm2geojson(osm, { completeFeature: true, ...opts }) as any;

describe('osmChange', () => {
    it('reads create and modify sections and drops deletes', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osmChange version="0.6" generator="test">
    <create>
        <node id="10" version="1" lat="1" lon="2"><tag k="name" v="new"/></node>
        <node id="11" version="1" lat="1" lon="3"/>
        <way id="20" version="1"><nd ref="10"/><nd ref="11"/><tag k="highway" v="path"/></way>
    </create>
    <modify>
        <node id="12" version="2" lat="4" lon="5"><tag k="name" v="changed"/></node>
    </modify>
    <delete>
        <node id="13" version="2"/>
        <way id="21" version="3"/>
    </delete>
</osmChange>`;

        const result = convert(xml, { renderTagged: true });
        const ids = result.features.map((f: any) => f.id).sort();
        expect(ids).toEqual(['node/10', 'node/12', 'way/20']);

        const way = result.features.find((f: any) => f.id === 'way/20');
        expect(way.geometry).toEqual({ type: 'LineString', coordinates: [[2, 1], [3, 1]] });
        expect(way.properties).toMatchObject({ id: 'way/20', highway: 'path', version: '1' });
    });

    it('skips the whole subtree of a deleted element', () => {
        const xml = `<osmChange>
    <delete>
        <node id="1" version="2"><tag k="name" v="gone"/></node>
        <relation id="2" version="2"><member type="node" ref="1" role=""/></relation>
    </delete>
</osmChange>`;
        const result = convert(xml);
        expect(result.features).toEqual([]);
    });

    it('does not revive unknown deleted elements as custom derived outputs', () => {
        const xml = '<osmChange><delete><area id="5"/></delete></osmChange>';
        expect(convert(xml).features).toEqual([]);
    });

    it('honours an action="delete" attribute on an element', () => {
        const xml = `<osm>
    <node id="1" version="1" lat="0" lon="0"/>
    <node id="2" version="2" lat="1" lon="1" action="delete"/>
</osm>`;
        const ids = convert(xml).features.map((f: any) => f.id);
        expect(ids).toEqual(['node/1']);
    });

    it('honours action="delete" in JSON', () => {
        const data = {
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 1, lon: 1, action: 'delete' },
            ],
        };
        const ids = convert(data).features.map((f: any) => f.id);
        expect(ids).toEqual(['node/1']);
    });

    it('keeps osmChange sections optional and empty', () => {
        expect(convert('<osmChange version="0.6"></osmChange>').features).toEqual([]);
        expect(convert('<osmChange version="0.6"><create/></osmChange>').features).toEqual([]);
    });
});
