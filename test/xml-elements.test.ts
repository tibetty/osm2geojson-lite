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

describe('XML corner cases', () => {
    it('accepts a self-closing root, a BOM and CRLF line endings', () => {
        expect(parseOsmXmlElements('<osm/>')).toEqual([]);
        expect(parseOsmXmlElements('<osmChange></osmChange>')).toEqual([]);
        const xml = '\uFEFF<osm>\r\n <node id="1" lat="0" lon="0"/>\r\n</osm>';
        expect(parseOsmXmlElements(xml)).toEqual([{ type: 'node', id: 1, lat: 0, lon: 0 }]);
    });

    it('decodes entities and single-quoted attributes', () => {
        const xml = `<osm><node id='1' lat='0' lon='0'><tag k='name' v='A &amp; B &#233; &lt;x&gt;'/></node></osm>`;
        expect(parseOsmXmlElements(xml)[0].tags).toEqual({ name: 'A & B é <x>' });
    });

    it('keeps values that contain > and comment-like text', () => {
        const xml = '<osm><node id="1" lat="0" lon="0"><tag k="note" v="a>b"/></node></osm>';
        expect(parseOsmXmlElements(xml)[0].tags).toEqual({ note: 'a>b' });
        expect(parseOsmXmlElements('<osm><!-- <node id="9"/> --><node id="1" lat="0" lon="0"/></osm>'))
            .toEqual([{ type: 'node', id: 1, lat: 0, lon: 0 }]);
    });

    it('handles way bounds with and without node references', () => {
        const xml = `<osm>
            <way id="1"><nd ref="10"/><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/></way>
            <way id="2"><bounds minlat="0" minlon="1" maxlat="2" maxlon="3"/></way>
        </osm>`;
        const [withNd, withoutNd] = parseOsmXmlElements(xml);
        expect(withNd.bounds).toBeUndefined();
        expect(withoutNd.bounds).toEqual({ minlat: 0, minlon: 1, maxlat: 2, maxlon: 3 });
    });

    it('marks an invalid derived vertex as tainted', () => {
        const xml = '<osm><node id="1"><point lat="1" lon="2"/><point lat="bad" lon="1"/></node></osm>';
        const [element] = parseOsmXmlElements(xml);
        expect(element).toMatchObject({ tainted: true, geometry: { type: 'Point', coordinates: [2, 1] } });

        // The element representation honours the flag exactly like the scanner.
        const viaElements = osm2geojson({ elements: [element] }, { completeFeature: true, tainted: true }) as any;
        const direct = osm2geojson(xml, { completeFeature: true, tainted: true }) as any;
        expect(viaElements).toEqual(direct);
        expect(viaElements.features[0].properties['@tainted']).toBe(true);
        expect(viaElements.features[0].properties.tainted).toBeUndefined();
    });

    it('emits relation member geometry', () => {
        const xml = `<osm><relation id="1">
            <member type="way" ref="10" role="outer"><nd lat="0" lon="0"/><nd lat="0" lon="1"/></member>
        </relation></osm>`;
        const [relation] = parseOsmXmlElements(xml);
        expect(relation.members[0].geometry).toEqual([{ lat: '0', lon: '0' }, { lat: '0', lon: '1' }]);
    });
});

describe('custom elements', () => {
    it('drops a custom element that has no derived geometry', () => {
        const xml = '<osm><count id="0"><tag k="nodes" v="1"/></count></osm>';
        expect(osm2geojson(xml, { completeFeature: true })).toEqual({ type: 'FeatureCollection', features: [] });
        expect(osm2geojson({ elements: [{ type: 'count', id: 0, tags: { nodes: '1' } }] }, { completeFeature: true }))
            .toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('converts a custom element with derived geometry', () => {
        const xml = '<osm><foo id="1"><point lat="1" lon="2"/><tag k="kind" v="x"/></foo></osm>';
        const feature = (osm2geojson(xml, { completeFeature: true }) as any).features[0];
        expect(feature.id).toBe('foo/1');
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
    });
});
