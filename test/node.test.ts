import { describe, expect, it } from 'vitest';
import { Node } from '../src/node';
import { RefElements } from '../src/ref-elements';

describe('Node', () => {
    it('registers by default and stays unregistered when requested', () => {
        const refs = new RefElements();
        const registered = new Node('1', refs);
        const unregistered = new Node('2', refs, false);
        expect(refs.get('node/1')).toBe(registered);
        expect(refs.get('node/2')).toBeUndefined();
    });

    it('has no feature before coordinates are set', () => {
        const node = new Node('1', new RefElements());
        expect(node.getLatLng()).toBeUndefined();
        expect(node.toFeatureArray()).toEqual([]);
    });

    it('exposes the coordinate object and builds a string-coordinate point', () => {
        const node = new Node('1', new RefElements());
        const latLng = { lat: '1.5', lon: '2.5' };
        node.setLatLng(latLng);
        expect(node.getLatLng()).toBe(latLng);
        expect(node.toFeatureArray()).toEqual([{
            type: 'Feature',
            id: 'node/1',
            properties: { id: 'node/1' },
            geometry: {
                type: 'Point',
                coordinates: [2.5, 1.5],
            },
        }]);
    });

    it('accepts numeric coordinates and includes tags and props', () => {
        const node = new Node('7', new RefElements());
        node.setLatLng({ lat: -3, lon: 4 });
        node.addTag('name', 'test');
        node.addProps({ version: 2 });
        const [feature] = node.toFeatureArray();
        expect(feature.geometry).toEqual({ type: 'Point', coordinates: [4, -3] });
        expect(feature.properties).toEqual({ id: 'node/7', version: 2, name: 'test' });
    });

    it('adds @tainted only when reportTainted is enabled', () => {
        const refs = new RefElements();
        refs.reportTainted = true;
        const node = new Node('1', refs);
        node.setLatLng({ lat: 0, lon: 0 });
        node.tainted = true;
        expect(node.toFeatureArray()[0].properties['@tainted']).toBe(true);

        refs.reportTainted = false;
        expect(node.toFeatureArray()[0].properties['@tainted']).toBeUndefined();
    });
});
