import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson from '../src/index';
import { parseOsmXmlElements } from '../src/osm-xml';

const files = fs.readdirSync('./test/data').filter((file) => file.endsWith('.osm'));
const opts = { completeFeature: true, renderTagged: true, tainted: true };

const viaElements = (xml: string, options: any = opts) => osm2geojson({ elements: parseOsmXmlElements(xml) }, options);

describe('XML to elements', () => {
    for (const file of files) {
        it(`round-trips ${file} through elements`, () => {
            const xml = fs.readFileSync(`./test/data/${file}`, 'utf-8');
            expect(viaElements(xml)).toEqual(osm2geojson(xml, opts));
        });
    }

    it('keeps node attributes, coordinates and tags', () => {
        const [element] = parseOsmXmlElements('<osm><node id="7" version="3" lat="1.5" lon="2.5" user="alice"><tag k="name" v="x"/></node></osm>');
        expect(element).toEqual({
            type: 'node',
            id: 7,
            version: '3',
            user: 'alice',
            lat: 1.5,
            lon: 2.5,
            tags: { name: 'x' },
        });
    });

    it('emits node references and derived coordinates for ways', () => {
        const xml = `<osm>
            <way id="10" version="2"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
            <way id="11"><nd lat="0" lon="1"/><nd lat="1" lon="2"/></way>
            <way id="12"><center lat="1" lon="2"/><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/></way>
        </osm>`;
        const elements = parseOsmXmlElements(xml);
        expect(elements[0]).toMatchObject({ type: 'way', id: 10, version: '2', nodes: [1, 2] });
        expect(elements[1]).toMatchObject({ type: 'way', id: 11, geometry: [{ lat: '0', lon: '1' }, { lat: '1', lon: '2' }] });
        expect(elements[2]).toMatchObject({
            type: 'way', id: 12,
            center: { lat: '1', lon: '2' },
            bounds: { minlat: 0, minlon: 1, maxlat: 2, maxlon: 3 },
        });
    });

    it('emits relation members in order with roles', () => {
        const xml = `<osm><relation id="20" version="1">
            <member type="way" ref="10" role="outer"/>
            <member type="node" ref="1" role="label"/>
            <member type="relation" ref="21" role="sub"/>
            <tag k="type" v="multipolygon"/>
        </relation></osm>`;
        const [relation] = parseOsmXmlElements(xml);
        expect(relation.members).toEqual([
            { type: 'way', ref: '10', role: 'outer' },
            { type: 'node', ref: '1', role: 'label' },
            { type: 'relation', ref: '21', role: 'sub' },
        ]);
        expect(relation.tags).toEqual({ type: 'multipolygon' });
    });

    it('marks osmChange deletions instead of dropping them', () => {
        const change = '<osmChange><delete><node id="3" version="4"/></delete></osmChange>';
        expect(parseOsmXmlElements(change)).toEqual([{ type: 'node', id: 3, version: '4', action: 'delete' }]);
    });

    it('marks visible=false elements', () => {
        const [element] = parseOsmXmlElements('<osm><node id="3" version="4" visible="false"/></osm>');
        expect(element.visible).toBe('false');
    });

    it('emits derived geometry and custom elements', () => {
        const xml = `<osm>
            <node id="1"><point lat="1" lon="2"/><tag k="name" v="p"/></node>
            <relation id="2"><linestring><vertex lat="0" lon="0"/><vertex lat="0" lon="1"/><vertex lat="1" lon="0"/></linestring></relation>
            <count id="0"><tag k="nodes" v="10"/></count>
        </osm>`;
        const elements = parseOsmXmlElements(xml);
        expect(elements[0].geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
        expect(elements[1].geometry.type).toBe('Polygon');
        expect(elements[2]).toMatchObject({ type: 'count', id: 0, tags: { nodes: '10' } });
    });
});
