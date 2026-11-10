import { describe, expect, it } from 'vitest';
import { decodeEntities } from '../src/xml-entities';

describe('decodeEntities', () => {
    it('leaves entity-free text untouched', () => {
        expect(decodeEntities('plain text')).toBe('plain text');
    });

    it('decodes named entities', () => {
        expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    });

    it('decodes decimal, lower-case hex and upper-case hex entities', () => {
        expect(decodeEntities('&#65;&#x42;&#X43;')).toBe('ABC');
    });

    it('keeps unknown and out-of-range entities unchanged', () => {
        expect(decodeEntities('&bogus;')).toBe('&bogus;');
        expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
        expect(decodeEntities('&#99999999999999999999;')).toBe('&#99999999999999999999;');
        expect(decodeEntities('&#x;')).toBe('&#x;');
    });

    it('decodes NUL and mixed content', () => {
        expect(decodeEntities('&#0;')).toBe('\u0000');
        expect(decodeEntities('a&amp;&#65;&bogus;z')).toBe('a&A&bogus;z');
    });
});
