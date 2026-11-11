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

describe('osmChange corner cases', () => {
    it('accepts sections in any order and empty sections', () => {
        const xml = `<osmChange>
            <delete><node id="1" version="2"/></delete>
            <modify></modify>
            <create><node id="2" version="1" lat="1" lon="1"/></create>
            <modify><node id="3" version="2" lat="2" lon="2"/></modify>
        </osmChange>`;
        expect(convert(xml).features.map((f: any) => f.id).sort()).toEqual(['node/2', 'node/3']);
    });

    it('ignores the if-unused attribute on a delete section', () => {
        const xml = '<osmChange><delete if-unused="true"><node id="1" version="2"/></delete></osmChange>';
        expect(convert(xml).features).toEqual([]);
    });

    it('treats action="modify" as ordinary data', () => {
        const xml = '<osmChange><modify><node id="1" version="2" lat="1" lon="2" action="modify"/></modify></osmChange>';
        expect(convert(xml).features).toHaveLength(1);
    });

    it('keeps JOSM negative ids in a create section', () => {
        const xml = `<osmChange>
            <create>
                <node id="-1" version="1" lat="0" lon="0"/>
                <node id="-2" version="1" lat="0" lon="1"/>
                <way id="-3" version="1"><nd ref="-1"/><nd ref="-2"/><tag k="highway" v="path"/></way>
            </create>
        </osmChange>`;
        const result = convert(xml);
        const way = result.features.find((f: any) => f.id === 'way/-3');
        expect(way.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 0]] });
    });

    it('deletes an element that carries no version', () => {
        const xml = '<osmChange><delete><node id="1"/></delete></osmChange>';
        expect(convert(xml).features).toEqual([]);
    });

    it('decodes entities in osmChange tags', () => {
        const xml = '<osmChange><modify><node id="1" version="2" lat="0" lon="0"><tag k="name" v="A &amp; B &#233;"/></node></modify></osmChange>';
        expect(convert(xml).features[0].properties.name).toBe('A & B é');
    });

    it('creates relations whose members reference the same diff', () => {
        const xml = `<osmChange><create>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <node id="3" version="1" lat="1" lon="1"/>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="natural" v="water"/></way>
            <relation id="20" version="1"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="name" v="lake"/></relation>
        </create></osmChange>`;
        const relation = convert(xml).features.find((f: any) => f.id === 'relation/20');
        expect(relation.geometry.type).toBe('Polygon');
    });
});
