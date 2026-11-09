import { describe, expect, it, vi } from 'vitest';
import { XmlParser, decodeEntities } from '../src/xmlparser';

const parse = (xml: string, opts: any = {}) => new XmlParser(opts).parse(xml);

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

describe('XmlParser structural parsing', () => {
    it('parses nested elements, attributes and self-closing leaves', () => {
        const roots = parse('<root a="1" b=\'2\'><child x="&amp;"/><empty/></root>');
        expect(roots).toHaveLength(1);
        const root = roots[0];
        expect(root.$tag).toBe('root');
        expect(root.a).toBe('1');
        expect(root.b).toBe('2');
        expect(root.$innerNodes).toHaveLength(2);
        expect(root.$innerNodes[0].$tag).toBe('child');
        expect(root.$innerNodes[0].x).toBe('&');
        expect(root.$innerNodes[1].$tag).toBe('empty');
    });

    it('returns multiple roots and ignores trailing text', () => {
        const roots = parse('<a/>text<b/>');
        expect(roots.map((node: any) => node.$tag)).toEqual(['a', 'b']);
        expect(parse('<a/>trailing text')).toHaveLength(1);
    });

    it('appends multiple non-self-closing children to a parent', () => {
        const roots = parse('<root><a></a><b></b></root>');
        expect(roots[0].$innerNodes.map((node: any) => node.$tag)).toEqual(['a', 'b']);
    });

    it('sets innerText only when the element has no child elements', () => {
        expect(parse('<a>hello</a>')[0].$innerText).toBe('hello');
        expect(parse('<a></a>')[0].$innerText).toBeUndefined();
        expect(parse('<a>hello<b/></a>')[0].$innerText).toBeUndefined();
        expect(parse('<a><b>text</b></a>')[0].$innerNodes[0].$innerText).toBe('text');
    });

    it('decodes entities in attributes and text', () => {
        const [node] = parse('<a x="&amp;&#65;&#x42;&#X43;">&lt;&gt;</a>');
        expect(node.x).toBe('&ABC');
        expect(node.$innerText).toBe('<>');
    });

    it('skips comments, processing instructions and doctypes', () => {
        const roots = parse('<?xml version="1.0"?><!-- a comment --><!DOCTYPE osm><a/>');
        expect(roots).toHaveLength(1);
        expect(roots[0].$tag).toBe('a');
    });

    it('supports quoted, boolean and oddly-spaced attributes', () => {
        const [node] = parse('<a x = "1" y = \'2\' disabled z="a>b"/>');
        expect(node.x).toBe('1');
        expect(node.y).toBe('2');
        expect(node.disabled).toBe('');
        expect(node.z).toBe('a>b');
    });

    it('supports namespaced/dashed tag names and literal whitespace', () => {
        const [node] = parse('<ns:a-b\nx="1"\ty="2"\r/>');
        expect(node.$tag).toBe('ns:a-b');
        expect(node.x).toBe('1');
        expect(node.y).toBe('2');
    });

    it('does not throw on unquoted or unterminated attributes', () => {
        expect(() => parse('<a x=1/>')).not.toThrow();
        expect(() => parse('<a x="1/>')).not.toThrow();
    });

    it('handles malformed and truncated documents gracefully', () => {
        for (const xml of ['', '</a>', '</a', '<a', '<?pi', '<!-- unterminated', '<!DOCTYPE', '<a><b>']) {
            expect(() => parse(xml)).not.toThrow();
        }
        expect(parse('')).toEqual([]);
        expect(parse('</a>')).toEqual([]);
        expect(parse('<a><b>')).toEqual([]);
    });

    it('appends to an existing parent $innerNodes across parses', () => {
        const parent: any = {};
        const parser = new XmlParser({});
        parser.parse('<a/>', parent);
        parser.parse('<b/>', parent);
        expect(parent.$innerNodes.map((node: any) => node.$tag)).toEqual(['a', 'b']);
    });
});

describe('XmlParser progressive events', () => {
    it('emits open and close events with parent nodes', () => {
        const parser = new XmlParser({ progressive: true });
        const events: string[] = [];
        parser.on('<root>', (node, parent) => events.push(`open:${node.$tag}:${parent ? parent.$tag : '-'}`));
        parser.on('</root>', (node, parent) => events.push(`close:${node.$tag}:${parent ? parent.$tag : '-'}`));
        parser.on('<root.a>', (node, parent) => events.push(`open-a:${node.$tag}:${parent ? parent.$tag : '-'}`));
        parser.on('</root.a>', (node, parent) => events.push(`close-a:${node.$tag}:${parent ? parent.$tag : '-'}`));
        parser.parse('<root><a/></root>');
        expect(events).toEqual([
            'open:root:-',
            'open-a:a:root',
            'close-a:a:root',
            'close:root:-',
        ]);
    });

    it('emits open and close for non-self-closing watched elements', () => {
        const parser = new XmlParser({ progressive: true });
        const open = vi.fn();
        const close = vi.fn();
        parser.on('<root.a>', open);
        parser.on('</root.a>', close);
        parser.parse('<root><a></a></root>');
        expect(open).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not emit events for unobserved paths', () => {
        const parser = new XmlParser({ progressive: true });
        const open = vi.fn();
        const close = vi.fn();
        parser.on('<root.a>', open);
        parser.on('</root.a>', close);
        parser.parse('<root><b/></root>');
        expect(open).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });

    it('supports multiple listeners for one event', () => {
        const parser = new XmlParser({ progressive: true });
        const first = vi.fn();
        const second = vi.fn();
        parser.on('</root.a>', first);
        parser.on('</root.a>', second);
        parser.parse('<root><a/></root>');
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('registers multiple children of the same parent', () => {
        const parser = new XmlParser({ progressive: true });
        const a = vi.fn();
        const b = vi.fn();
        parser.on('</root.a>', a);
        parser.on('</root.b>', b);
        parser.parse('<root><a/><b/></root>');
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('honours conditioned listeners on open and close events', () => {
        const parser = new XmlParser({ progressive: true });
        const open = vi.fn();
        const yes = vi.fn();
        const no = vi.fn();
        const plain = vi.fn();
        parser.on("<root.a[$tag==='a']>", open);
        parser.on("</root.a[$tag==='a']>", yes);
        parser.on("</root.a[$tag==='b']>", no);
        parser.on('</root.a>', plain);
        parser.parse('<root><a/></root>');
        expect(open).toHaveBeenCalledTimes(1);
        expect(yes).toHaveBeenCalledTimes(1);
        expect(no).not.toHaveBeenCalled();
        expect(plain).toHaveBeenCalledTimes(1);
    });

    it('removes listeners with on/off and removeListener', () => {
        const parser = new XmlParser({ progressive: true });
        const closed = vi.fn();
        const opened = vi.fn();
        parser.on('</root.a>', closed);
        parser.off('</root.a>', closed);
        parser.on('<root.a>', opened);
        parser.removeListener('<root.a>', opened);
        parser.parse('<root><a/></root>');
        expect(closed).not.toHaveBeenCalled();
        expect(opened).not.toHaveBeenCalled();
    });

    it('removes conditioned listeners', () => {
        const parser = new XmlParser({ progressive: true });
        const fn = vi.fn();
        parser.on("</root.a[$tag==='a']>", fn);
        parser.off("</root.a[$tag==='a']>", fn);
        parser.parse('<root><a/></root>');
        expect(fn).not.toHaveBeenCalled();
    });

    it('ignores removals for unknown events or different functions', () => {
        const parser = new XmlParser({ progressive: true });
        const added = vi.fn();
        const other = vi.fn();
        parser.removeListener('</never>', other);
        parser.on('</root.a>', added);
        parser.removeListener('</root.a>', other);
        parser.parse('<root><a/></root>');
        expect(added).toHaveBeenCalledTimes(1);
        expect(other).not.toHaveBeenCalled();
    });

    it('treats events that merely contain "[" as unconditioned', () => {
        const parser = new XmlParser({ progressive: true });
        const fn = vi.fn();
        parser.addListener('</root.a[foo>', fn);
        parser.removeListener('</root.a[foo>', fn);
        parser.parse('<root><a/></root>');
        expect(fn).not.toHaveBeenCalled();
    });

    it('accepts and removes non-tag event names', () => {
        const parser = new XmlParser({ progressive: true });
        const fn = vi.fn();
        parser.addListener('custom-event', fn);
        parser.removeListener('custom-event', fn);
        parser.parse('<a/>');
        expect(fn).not.toHaveBeenCalled();
    });

    it('does not emit progressive events when progressive is false', () => {
        const parser = new XmlParser({ progressive: false });
        const fn = vi.fn();
        parser.on('</root.a>', fn);
        parser.parse('<root><a/></root>');
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('XmlParser parent tracking and dir prefixes', () => {
    it('tracks parents with queryParent', () => {
        const parser = new XmlParser({ queryParent: true });
        const roots = parser.parse('<root><a><b/></a></root>');
        const root = roots[0];
        const a = root.$innerNodes[0];
        const b = a.$innerNodes[0];
        expect(parser.getParent(a)).toBe(root);
        expect(parser.getParent(b)).toBe(a);
        expect(parser.getParent(root)).toBeUndefined();
        expect(parser.getParent({})).toBeUndefined();
    });

    it('returns null from getParent without queryParent', () => {
        const parser = new XmlParser({ queryParent: false });
        parser.parse('<a/>');
        expect(parser.getParent({})).toBeNull();
    });

    it('attaches parsed nodes to a supplied parent', () => {
        const parent: any = { $tag: 'container' };
        const parser = new XmlParser({ queryParent: true });
        const roots = parser.parse('<child x="1">text</child>', parent);
        expect(roots).toEqual([]);
        expect(parent.$innerNodes).toHaveLength(1);
        expect(parent.$innerNodes[0].x).toBe('1');
        expect(parent.$innerNodes[0].$innerText).toBe('text');
        expect(parser.getParent(parent.$innerNodes[0])).toBe(parent);
    });

    it('applies a dir prefix to events', () => {
        const parser = new XmlParser({ progressive: true });
        const events: string[] = [];
        parser.on('<osm.root>', () => events.push('open'));
        parser.on('</osm.root>', () => events.push('close'));
        parser.parse('<root></root>', undefined, 'osm');
        expect(events).toEqual(['open', 'close']);
    });

    it('applies a dir prefix to self-closing top-level events', () => {
        const parser = new XmlParser({ progressive: true });
        const events: string[] = [];
        parser.on('<osm.tag>', () => events.push('open'));
        parser.on('</osm.tag>', () => events.push('close'));
        parser.parse('<tag/>', undefined, 'osm');
        expect(events).toEqual(['open', 'close']);
    });

    it('combines parent and dir prefixes', () => {
        const parent: any = { $tag: 'container' };
        const parser = new XmlParser({ progressive: true });
        const events: string[] = [];
        parser.on('<osm.child>', () => events.push('open'));
        parser.on('</osm.child>', () => events.push('close'));
        parser.parse('<child/>', parent, 'osm');
        expect(events).toEqual(['open', 'close']);
        expect(parent.$innerNodes).toHaveLength(1);
    });

    it('uses the top-level path when a parent has no dir', () => {
        const parent: any = { $tag: 'container' };
        const parser = new XmlParser({ progressive: true });
        const events: string[] = [];
        parser.on('<child>', () => events.push('open'));
        parser.on('</child>', () => events.push('close'));
        parser.parse('<child/>', parent);
        expect(events).toEqual(['open', 'close']);
    });
});
