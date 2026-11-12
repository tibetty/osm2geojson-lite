import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import osm2geojson, { applyOsmChange, mergeOsmChange } from '../src/index';
import { decodeInput } from '../src/cli-input';

/**
 * Real osmChange files taken from the Geofabrik Monaco update stream (osmium
 * generated, unicode tags, `<modify>` before and after `<delete>`, deletes that
 * carry no coordinates). The base extract is the committed `monaco.osm.pbf`,
 * which is newer than these diffs, so applying them exercises the stale path
 * with real data.
 */

const read = (file: string) => fs.readFileSync(`./test/data/${file}`, 'utf-8');
const diff960 = read('monaco-960.osc');
const diff900 = read('monaco-900.osc');
const pbf = new Uint8Array(fs.readFileSync('./test/data/monaco.osm.pbf'));
const opts = { completeFeature: true, renderTagged: true };

describe('real osmChange diff', () => {
    it('converts the modifications of a diff that has no deletions', () => {
        const features = (osm2geojson(diff960, { completeFeature: true }) as any).features;
        expect(features.map((feature: any) => feature.id).sort()).toEqual(['node/14354106001', 'node/6684051501']);

        const monaco = features.find((feature: any) => feature.id === 'node/6684051501');
        expect(monaco.geometry).toEqual({ type: 'Point', coordinates: [7.4276832, 43.7323492] });
        expect(monaco.properties).toMatchObject({
            version: '34',
            'name:ja': 'モナコ',
            'name:ar': 'موناكو',
            'name:ko': '모나코',
        });
    });

    it('reads the same diff from its gzip container', () => {
        const gzipped = fs.readFileSync('./test/data/monaco-960.osc.gz');
        expect(decodeInput(gzipped)).toBe(diff960);
        expect(osm2geojson(decodeInput(gzipped), { completeFeature: true }))
            .toEqual(osm2geojson(diff960, { completeFeature: true }));
    });

    it('converts a diff with create sections', () => {
        const diff = read('monaco-950.osc');
        const features = (osm2geojson(diff, { completeFeature: true }) as any).features;
        expect(features).toHaveLength(11);

        const created = features.find((feature: any) => feature.id === 'node/14323457501');
        expect(created.properties).toMatchObject({ tourism: 'viewpoint', version: '1' });
        expect(created.geometry.coordinates).toEqual([7.4221198, 43.7298151]);

        // The diff also creates a relation, but its member ways are not part of
        // the diff, so it has no geometry of its own here.
        expect(features.some((feature: any) => feature.id.startsWith('relation/'))).toBe(false);
    });

    it('decodes entities in real diff tags', () => {
        const diff = read('monaco-950.osc');
        const node = osm2geojson(diff, { elementId: 'node/6482565666' }) as any;
        expect(node.properties.name).toBe("Cap d'Ail");
        expect(node.properties.traffic_sign).toBe('city_limit');
    });

    it('reads the create diff from its gzip container', () => {
        const gzipped = fs.readFileSync('./test/data/monaco-950.osc.gz');
        expect(decodeInput(gzipped)).toBe(read('monaco-950.osc'));
    });

    it('cannot render geometry from a diff alone when its ways lost their nodes', () => {
        // The diff modifies ways whose other nodes only exist in the base, and
        // deletes the only tagged line, so nothing is renderable in isolation.
        expect((osm2geojson(diff900, { completeFeature: true }) as any).features).toEqual([]);
    });

    it('reports stale entries when a newer base is paired with an older diff', () => {
        const applied = applyOsmChange(pbf, diff900, opts);
        const base = osm2geojson(pbf, opts) as any;

        expect(applied.geojson.features).toHaveLength(base.features.length);
        expect(applied.conflicts).toEqual([
            { id: 'node/1690189834', changeVersion: 4, baseVersion: 6279 },
            { id: 'way/686912272', changeVersion: 4, baseVersion: 4 },
            { id: 'way/946562630', changeVersion: 7, baseVersion: 7 },
        ]);
        // Nothing was appended or duplicated: a stale entry is a replacement
        // that lost, not a create.
        const ids = applied.geojson.features.map((feature: any) => feature.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(9772);
    });

    it('keeps every merged element unique and reports the same conflicts', () => {
        const merged = mergeOsmChange(pbf, diff900);
        const ids = merged.elements.map((element) => `${element.type}/${element.id}`);
        expect(merged.elements).toHaveLength(48472);
        expect(new Set(ids).size).toBe(48472);
        expect(merged.conflicts).toHaveLength(3);
    });

    it('applies a diff to a base from the same moment with no conflicts', () => {
        // Base reconstructed from OSM attic data at 2026-09-04T16:49Z, one
        // minute before the diff was produced.
        const base = read('monaco-base-2026-09-04.osm');
        const applied = applyOsmChange(base, diff900, { ...opts, excludeWay: false, tainted: true });
        expect(applied.conflicts).toEqual([]);

        const features = (applied.geojson as any).features;
        const ids = features.map((feature: any) => feature.id);
        expect(ids).toContain('way/686912272');
        expect(ids).toContain('way/946562630');
        expect(ids).not.toContain('way/156780344');

        const modified = features.find((feature: any) => feature.id === 'way/686912272');
        expect(modified.properties.version).toBe('4');
        expect(modified.geometry.type).toBe('LineString');
        expect(features.find((feature: any) => feature.id === 'way/946562630').properties.version).toBe('7');
    });

    it('throws in strict mode naming the first stale entry', () => {
        expect(() => applyOsmChange(pbf, diff900, { ...opts, strict: true }))
            .toThrow(/stale osmChange entry for node\/1690189834: version 4 does not advance base version 6279/);
    });
});
