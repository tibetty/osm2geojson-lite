import { describe, expect, it } from 'vitest';
import {
    addToMap,
    boundsToRing,
    coordsToKey,
    first,
    isFiniteBounds,
    isFiniteCoordinate,
    isRing,
    last,
    pointInsidePolygon,
    purgeProps,
    ringBounds,
    ringDirection,
    strArrayArrayToFloat,
    strArrayToFloat,
} from '../src/utils';

describe('purgeProps', () => {
    it('copies an object and removes blacklisted keys', () => {
        expect(purgeProps({ a: 1, b: 2, c: 3 }, ['b', 'c'])).toEqual({ a: 1 });
        expect(purgeProps({ a: 1 }, [])).toEqual({ a: 1 });
        expect(purgeProps({ a: 1 }, undefined as any)).toEqual({ a: 1 });
    });

    it('returns an empty object for nullish input', () => {
        expect(purgeProps(null as any, ['a'])).toEqual({});
        expect(purgeProps(undefined as any, ['a'])).toEqual({});
    });
});

describe('small sequence helpers', () => {
    it('returns the first and last element', () => {
        expect(first([1, 2, 3])).toBe(1);
        expect(last([1, 2, 3])).toBe(3);
    });

    it('serialises coordinates to map keys', () => {
        expect(coordsToKey([1, 2])).toBe('1,2');
        expect(coordsToKey(['a', 'b'])).toBe('a,b');
        expect(coordsToKey([])).toBe('');
    });
});

describe('endpoint maps', () => {
    it('adds to new and existing buckets', () => {
        const map: Record<string, number[]> = {};
        addToMap(map, 'a', 1);
        addToMap(map, 'a', 2);
        expect(map.a).toEqual([1, 2]);
    });
});

describe('finite coordinate and bounds validation', () => {
    it('accepts finite numbers and numeric strings', () => {
        expect(isFiniteCoordinate(0, 0)).toBe(true);
        expect(isFiniteCoordinate('-12.5', '42')).toBe(true);
    });

    it('rejects missing, empty, non-numeric and non-finite coordinates', () => {
        expect(isFiniteCoordinate('', 0)).toBe(false);
        expect(isFiniteCoordinate(null, 0)).toBe(false);
        expect(isFiniteCoordinate(undefined, 0)).toBe(false);
        expect(isFiniteCoordinate(Number.NaN, 0)).toBe(false);
        expect(isFiniteCoordinate(Infinity, 0)).toBe(false);
        expect(isFiniteCoordinate({}, 0)).toBe(false);
    });

    it('accepts only four finite bounds', () => {
        expect(isFiniteBounds([0, 0, 1, 1])).toBe(true);
        expect(isFiniteBounds(['0', '0', '1', '1'])).toBe(true);
        expect(isFiniteBounds([0, 0, 1])).toBe(false);
        expect(isFiniteBounds([0, 0, 1, Number.NaN])).toBe(false);
        expect(isFiniteBounds([0, 0, 1, ''])).toBe(false);
        expect(isFiniteBounds(null)).toBe(false);
        expect(isFiniteBounds('0,0,1,1')).toBe(false);
    });
});

describe('isRing', () => {
    it('rejects sequences with three or fewer points', () => {
        expect(isRing([])).toBe(false);
        expect(isRing([[0, 0], [1, 0], [0, 1]])).toBe(false);
    });

    it('accepts closed sequences and rejects open ones', () => {
        expect(isRing([[0, 0], [1, 0], [1, 1], [0, 0]])).toBe(true);
        expect(isRing([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(false);
        expect(isRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])).toBe(true);
    });
});

describe('boundsToRing', () => {
    it('builds a closed rectangle from [minlon, minlat, maxlon, maxlat]', () => {
        expect(boundsToRing([1, 0, 3, 2])).toEqual([
            [1, 0],
            [3, 0],
            [3, 2],
            [1, 2],
            [1, 0],
        ]);
    });
});

describe('ringDirection', () => {
    const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const cw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];

    it('detects counter-clockwise and clockwise rings', () => {
        expect(ringDirection(ccw)).toBe('counterclockwise');
        expect(ringDirection(cw)).toBe('clockwise');
    });

    it('supports explicit x/y indices', () => {
        // Same ring with [lat, lon] ordering: x is at index 1.
        const latLon = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
        expect(ringDirection(latLon, 1, 0)).toBe('counterclockwise');
        expect(ringDirection(ccw, 0, 1)).toBe('counterclockwise');
    });

    it('handles a maximum x at the first point', () => {
        const open = [[2, 0], [0, 0], [0, 1], [1, 1]];
        expect(ringDirection(open)).toBe('clockwise');
    });

    it('handles a maximum x at the last point', () => {
        const ring = [[2, 0], [0, 0], [0, 1], [1, 1], [2, 0]];
        expect(ringDirection(ring)).toBe('clockwise');
    });
});

describe('ringBounds', () => {
    it('computes the bounding box on a cache miss and reuses it', () => {
        const ring = [[-1, 3], [2, 3], [2, -4], [-1, -4], [-1, 3]];
        const bounds = ringBounds(ring);
        expect(bounds).toEqual({ minX: -1, maxX: 2, minY: -4, maxY: 3 });
        expect(ringBounds(ring)).toBe(bounds);
    });

    it('uses bounds collected by a previous ringDirection scan', () => {
        const ring = [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]];
        ringDirection(ring);
        expect(ringBounds(ring)).toEqual({ minX: 0, maxX: 4, minY: 0, maxY: 2 });
    });
});

describe('pointInsidePolygon', () => {
    const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];

    it('detects inside and outside points', () => {
        expect(pointInsidePolygon([1, 1], outer)).toBe(true);
        expect(pointInsidePolygon([3, 3], outer)).toBe(false);
        expect(pointInsidePolygon([-1, 1], outer)).toBe(false);
    });

    it('handles concave polygons with multiple crossings', () => {
        const concave = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
        expect(pointInsidePolygon([0.5, 0.5], concave)).toBe(true);
        expect(pointInsidePolygon([1.5, 1.5], concave)).toBe(false);
    });

    it('supports explicit x/y indices', () => {
        const latLon = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
        expect(pointInsidePolygon([1, 1], latLon, 1, 0)).toBe(true);
    });
});

describe('string coordinate conversion', () => {
    it('converts one and two-dimensional string arrays', () => {
        expect(strArrayToFloat(['1.5', '2', '-3e2'])).toEqual([1.5, 2, -300]);
        expect(strArrayArrayToFloat([['1', '2'], ['3.5', '4']])).toEqual([[1, 2], [3.5, 4]]);
    });
});
