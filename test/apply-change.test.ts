import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange, toElements } from '../src/index';
import { sampleFile } from './pbf-encoder';

const opts = { completeFeature: true, renderTagged: true, excludeWay: false };
const apply = (base: any, change: any, extra?: any) => applyOsmChange(base, change, { ...opts, ...extra }).geojson as any;

const base = {
    elements: [
        { type: 'node', id: 1, version: 1, lat: 0, lon: 0, tags: { name: 'old' } },
        { type: 'node', id: 2, version: 1, lat: 0, lon: 1 },
        { type: 'node', id: 3, version: 1, lat: 1, lon: 1 },
        { type: 'way', id: 10, version: 1, nodes: [1, 2, 3], tags: { highway: 'path' } },
    ],
};

describe('toElements', () => {
    it('normalises every input format to the same elements', () => {
        const xml = '<osm><node id="1" version="2" lat="1" lon="2"><tag k="name" v="a"/></node></osm>';
        const json = '<osm><node id="1" version="2" lat="1" lon="2"><tag k="name" v="a"/></node></osm>';
        expect(toElements(xml)).toEqual(toElements(json));
        expect(toElements(xml)[0]).toMatchObject({ type: 'node', id: 1, version: '2', lat: 1, lon: 2 });
    });

    it('collapses versions and drops deleted elements', () => {
        const elements = toElements({
            elements: [
                { type: 'node', id: 1, version: 1, lat: 0, lon: 0 },
                { type: 'node', id: 1, version: 2, visible: false },
                { type: 'node', id: 2, version: 1, lat: 1, lon: 1 },
            ],
        });
        expect(elements.map((element) => element.id)).toEqual([2]);
    });

    it('reads PBF through the same path', () => {
        expect(toElements(sampleFile()).length).toBe(6);
    });
});

describe('mergeOsmChange', () => {
    it('merges at the element level and reports conflicts separately', () => {
        const change = '<osmChange><modify><node id="1" version="2" lat="5" lon="6"/></modify></osmChange>';
        const merged = mergeOsmChange(base, change);
        const node = merged.elements.find((element) => element.id === 1);
        expect(node).toMatchObject({ type: 'node', id: 1, version: '2', lat: 5, lon: 6 });
        expect(Object.keys(node.tags || {})).toHaveLength(0);
        expect(merged.conflicts).toEqual([]);

        // The merged document converts like any other input.
        const feature = osm2geojson({ elements: merged.elements }, { ...opts, elementId: 'node/1' }) as any;
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [6, 5] });
    });

    it('keeps the base element order and appends creates', () => {
        const change = '<osmChange><create><node id="4" version="1" lat="9" lon="9"/></create></osmChange>';
        const merged = mergeOsmChange(base, change);
        expect(merged.elements.map((element) => element.id)).toEqual([1, 2, 3, 10, 4]);
    });

    it('reports a stale entry with both versions', () => {
        const change = '<osmChange><modify><node id="1" version="1" lat="5" lon="6"/></modify></osmChange>';
        const merged = mergeOsmChange(base, change);
        expect(merged.conflicts).toEqual([{ id: 'node/1', changeVersion: 1, baseVersion: 1 }]);
        expect(merged.elements.find((element) => element.id === 1)).toMatchObject({ lat: 0, lon: 0 });
    });

    it('reports a stale delete and keeps the element', () => {
        const current = { elements: [{ type: 'node', id: 2, version: 3, lat: 0, lon: 1 }] };
        const change = '<osmChange><delete><node id="2" version="3"/></delete></osmChange>';
        const merged = mergeOsmChange(current, change);
        expect(merged.conflicts).toEqual([{ id: 'node/2', changeVersion: 3, baseVersion: 3 }]);
        expect(merged.elements.map((element) => element.id)).toEqual([2]);
    });
});

describe('applyOsmChange', () => {
    it('applies a modify over the base', () => {
        const change = '<osmChange><modify><node id="1" version="2" lat="5" lon="6"><tag k="name" v="new"/></node></modify></osmChange>';
        const node = apply(base, change).features.find((f: any) => f.id === 'node/1');
        expect(node.geometry).toEqual({ type: 'Point', coordinates: [6, 5] });
        expect(node.properties).toMatchObject({ id: 'node/1', name: 'new', version: '2' });
    });

    it('applies a delete and taints the way that referenced the element', () => {
        const change = '<osmChange><delete><node id="2" version="2"/></delete></osmChange>';
        const result = apply(base, change, { tainted: true });
        expect(result.features.map((f: any) => f.id)).not.toContain('node/2');
        const way = result.features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[0, 0], [1, 1]]);
        expect(way.properties['@tainted']).toBe(true);
    });

    it('adds a created element', () => {
        const change = '<osmChange><create><node id="4" version="1" lat="9" lon="9"><tag k="name" v="fresh"/></node></create></osmChange>';
        expect(apply(base, change).features.find((f: any) => f.id === 'node/4').properties.name).toBe('fresh');
    });

    it('ignores a stale modify so the base cannot roll back', () => {
        const change = '<osmChange><modify><node id="1" version="1" lat="5" lon="6"><tag k="name" v="stale"/></node></modify></osmChange>';
        const node = apply(base, change).features.find((f: any) => f.id === 'node/1');
        expect(node.properties.name).toBe('old');
        expect(node.geometry.coordinates).toEqual([0, 0]);
    });

    it('returns conflicts as data', () => {
        const change = '<osmChange><modify><node id="1" version="1" lat="5" lon="6"/></modify></osmChange>';
        const applied = applyOsmChange(base, change, opts);
        expect(applied.conflicts).toEqual([{ id: 'node/1', changeVersion: 1, baseVersion: 1 }]);
        expect((applied.geojson as any).features).toHaveLength(2);
    });

    it('throws on stale entries in strict mode', () => {
        const staleModify = '<osmChange><modify><node id="1" version="1" lat="5" lon="6"/></modify></osmChange>';
        expect(() => apply(base, staleModify, { strict: true }))
            .toThrow(/stale osmChange entry for node\/1: version 1 does not advance base version 1/);
        const staleDelete = '<osmChange><delete><node id="1" version="1"/></delete></osmChange>';
        expect(() => apply(base, staleDelete, { strict: true })).toThrow(/stale osmChange entry for node\/1/);
    });

    it('takes the newest entry when a diff repeats an element', () => {
        const change = `<osmChange>
            <modify><node id="1" version="2" lat="1" lon="1"/></modify>
            <modify><node id="1" version="3" lat="2" lon="2"/></modify>
        </osmChange>`;
        const node = applyOsmChange(base, change, { ...opts, elementId: 'node/1' }).geojson as any;
        expect(node.geometry.coordinates).toEqual([2, 2]);
        expect(node.properties.version).toBe('3');
    });

    it('applies an osmChange to an XML base', () => {
        const xmlBase = `<osm>
            <node id="1" version="1" lat="0" lon="0"/>
            <node id="2" version="1" lat="0" lon="1"/>
            <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
        </osm>`;
        const change = '<osmChange><modify><node id="2" version="2" lat="0" lon="5"/></modify></osmChange>';
        const way = apply(xmlBase, change).features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[0, 0], [5, 0]]);
    });

    it('applies an osmChange to a PBF base', () => {
        const change = '<osmChange><modify><node id="1" version="4" lat="9" lon="9"/></modify></osmChange>';
        const node = applyOsmChange(sampleFile(), change, { ...opts, elementId: 'node/1' }).geojson as any;
        expect(node.geometry.coordinates).toEqual([9, 9]);
        expect(node.properties.version).toBe('4');
    });

    it('does not merge base tags into a modified element', () => {
        // An osmChange entry is a complete element version, not a patch.
        const change = '<osmChange><modify><node id="1" version="2" lat="5" lon="6"/></modify></osmChange>';
        const node = applyOsmChange(base, change, { ...opts, elementId: 'node/1' }).geojson as any;
        expect(node.properties.name).toBeUndefined();
        expect(node.properties.version).toBe('2');
    });

    it('leaves a plain conversion unaffected by the strict flag', () => {
        const converted = osm2geojson(base, { ...opts, strict: true }) as any;
        expect(converted.features).toHaveLength(2);
    });
});

describe('merge corner cases', () => {
    it('reports every conflict in base order without duplicating elements', () => {
        const apply3 = '<osmChange><modify><node id="1" version="1" lat="9" lon="9"/></modify><modify><node id="3" version="1" lat="9" lon="9"/></modify></osmChange>';
        const merged = mergeOsmChange(base, apply3);
        expect(merged.conflicts).toEqual([
            { id: 'node/1', changeVersion: 1, baseVersion: 1 },
            { id: 'node/3', changeVersion: 1, baseVersion: 1 },
        ]);
        const ids = merged.elements.map((element) => `${element.type}/${element.id}`);
        expect(new Set(ids).size).toBe(ids.length);
        expect(merged.elements).toHaveLength(4);
    });

    it('appends a JOSM negative id create', () => {
        const change = '<osmChange><create><node id="-1" version="1" lat="1" lon="2"><tag k="name" v="new"/></node></create></osmChange>';
        const merged = mergeOsmChange(base, change);
        expect(merged.elements).toHaveLength(5);
        expect(merged.elements[4]).toMatchObject({ type: 'node', id: -1 });
        expect(merged.conflicts).toEqual([]);
    });

    it('follows a way whose node list changed', () => {
        const change = '<osmChange><modify><way id="10" version="2"><nd ref="1"/><nd ref="3"/><tag k="highway" v="path"/></way></modify></osmChange>';
        const way = apply(base, change).features.find((f: any) => f.id === 'way/10');
        expect(way.geometry.coordinates).toEqual([[0, 0], [1, 1]]);
    });

    it('taints a relation that references a deleted way', () => {
        const withRoute = {
            elements: [
                { type: 'node', id: 1, version: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, version: 1, lat: 0, lon: 1 },
                { type: 'node', id: 3, version: 1, lat: 1, lon: 1 },
                { type: 'node', id: 4, version: 1, lat: 1, lon: 2 },
                { type: 'way', id: 10, version: 1, nodes: [1, 2], tags: { highway: 'path' } },
                { type: 'way', id: 11, version: 1, nodes: [3, 4], tags: { highway: 'path' } },
                {
                    type: 'relation', id: 20, version: 1, tags: { type: 'route' },
                    members: [{ type: 'way', ref: 10, role: '' }, { type: 'way', ref: 11, role: '' }],
                },
            ],
        };
        const applied = applyOsmChange(withRoute, '<osmChange><delete><way id="11" version="2"/></delete></osmChange>', { ...opts, tainted: true });
        const relation = (applied.geojson as any).features.find((f: any) => f.id === 'relation/20');
        expect(relation.properties['@tainted']).toBe(true);
        expect(relation.geometry.coordinates).toEqual([[[0, 0], [1, 0]]]);
        expect(applied.conflicts).toEqual([]);
    });

    it('leaves the base untouched for an empty diff', () => {
        const merged = mergeOsmChange(base, '<osmChange version="0.6"></osmChange>');
        expect(merged.conflicts).toEqual([]);
        expect(merged.elements.map((element) => `${element.type}/${element.id}`))
            .toEqual(['node/1', 'node/2', 'node/3', 'way/10']);
    });

    it('keeps every element when all entries are stale', () => {
        const change = '<osmChange><modify><node id="1" version="1" lat="9" lon="9"/></modify><modify><node id="2" version="1" lat="9" lon="9"/></modify></osmChange>';
        const merged = mergeOsmChange(base, change);
        expect(merged.conflicts).toHaveLength(2);
        expect(merged.elements).toHaveLength(4);
        expect(merged.elements.find((element) => element.id === 1)).toMatchObject({ lat: 0 });
    });

    it('does not throw in strict mode when there is no conflict', () => {
        const change = '<osmChange><modify><node id="1" version="2" lat="9" lon="9"/></modify></osmChange>';
        expect(() => mergeOsmChange(base, change, { strict: true })).not.toThrow();
    });

    it('keeps node references, not resolved geometry, in merged elements', () => {
        const merged = mergeOsmChange(base, '<osmChange></osmChange>');
        expect(merged.elements.find((element) => element.id === 10)).toMatchObject({ nodes: [1, 2, 3] });
    });

    it('preserves relation member order from an XML base', () => {
        const xmlBase = `<osm><relation id="20" version="1">
            <member type="way" ref="10" role="outer"/>
            <member type="node" ref="2" role="label"/>
            <member type="relation" ref="21" role="sub"/>
            <tag k="type" v="multipolygon"/>
        </relation></osm>`;
        const merged = mergeOsmChange(xmlBase, '<osmChange></osmChange>');
        expect(merged.elements[0].members.map((member: any) => member.type)).toEqual(['way', 'node', 'relation']);
    });
});
