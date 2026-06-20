/**
 * Whether an event carries a trailing condition expression, written as
 * `<path[expr]>`. The cheap `[` check skips the regex for the common
 * unconditioned events.
 */
function conditioned(evt: string): boolean {
    return evt.indexOf('[') >= 0 && /^(.+?)\[(.+?)\]>$/.test(evt);
}

function parseEvent(evt: string): { evt: string, exp?: string } {
    const match = /^(.+?)\[(.+?)\]>$/g.exec(evt);
    if (match) {
        return { evt: match[1] + '>', exp: match[2] };
    }
    return { evt };
}

function genConditionFunc(cond: string): (node: { [k: string]: any }) => boolean {
    const body = 'return ' + cond.replace(/(\$.+?)(?=[=!.])/g, 'node.$&') + ';';
    return new Function('node', body) as (node: { [k: string]: any }) => boolean;
}

// character codes used by the scanner
const LT = 60;        // <
const GT = 62;        // >
const SLASH = 47;     // /
const BANG = 33;      // !
const QUESTION = 63;  // ?
const EQUALS = 61;    // =
const DQUOTE = 34;    // "
const SQUOTE = 39;    // '
const SPACE = 32;
const TAB = 9;
const LF = 10;
const CR = 13;

function isSpace(c: number): boolean {
    return c === SPACE || c === TAB || c === LF || c === CR;
}

interface Frame {
    node: { [k: string]: any };
    fullTag: string;
    textStart: number;
}

export class XmlParser {
    private queryParent: boolean = false;
    private progressive: boolean = false;
    private parentMap: WeakMap<any, any> = new WeakMap();
    private evtListeners: { [k: string]: any };
    /**
     * Number of registered open-tag (`<path>`) listeners; lets the scanner skip
     * building open-event strings for the overwhelmingly common leaf elements.
     */
    private openListenerCount: number = 0;

    constructor(opts: any) {
        if (opts) {
            this.queryParent = opts.queryParent ? true : false;
            this.progressive = opts.progressive;
            if (this.queryParent) {
                this.parentMap = new WeakMap();
            }
        }
        this.evtListeners = {};
    }

    /**
     * Scan an XML string in a single pass, maintaining a stack of open elements,
     * building a `$tag`/attribute/`$innerNodes` node tree and emitting
     * progressive `<path>` / `</path>` events as elements open and close.
     *
     * @param xml - the XML source to scan.
     * @param parent - optional pre-existing node that owns the parsed content;
     * when supplied, top-level nodes attach to its `$innerNodes` instead of being
     * returned as roots.
     * @param dir - optional dotted tag-path prefix applied to emitted event names.
     * @returns the top-level nodes (empty when a `parent` owns them).
     */
    public parse(xml: string, parent?: any, dir?: string) {
        const len = xml.length;
        const progressive = this.progressive;
        const queryParent = this.queryParent;
        const parentMap = this.parentMap;

        const basePath = dir ? dir : '';
        const roots: any[] = [];
        const stack: Frame[] = [];
        const hasOpenListeners = progressive && this.openListenerCount > 0;
        let top: Frame | undefined = parent
            ? { node: parent, fullTag: basePath, textStart: 0 }
            : undefined;
        const rootOwner = top;

        let i = 0;
        while (i < len) {
            const lt = xml.indexOf('<', i);
            if (lt < 0) {
                break;
            }
            i = lt + 1;
            const c = xml.charCodeAt(i);

            if (c === SLASH) {
                // closing tag: </tag>
                const gt = xml.indexOf('>', i);
                if (gt < 0) {
                    break;
                }
                const frame = stack.pop();
                i = gt + 1;
                if (!frame) {
                    continue;
                }
                const node = frame.node;
                const parentFrame = stack.length ? stack[stack.length - 1] : rootOwner;
                const parentNode = parentFrame ? parentFrame.node : undefined;

                if (!node.$innerNodes && lt > frame.textStart) {
                    node.$innerText = xml.slice(frame.textStart, lt);
                }

                if (progressive) {
                    this.emit('</' + frame.fullTag + '>', node, parentNode);
                }

                if (parentNode) {
                    const inner = parentNode.$innerNodes;
                    if (inner) {
                        inner.push(node);
                    } else {
                        parentNode.$innerNodes = [node];
                    }
                } else {
                    roots.push(node);
                }
                top = parentFrame;
                continue;
            }

            if (c === QUESTION) {
                // processing instruction: <? ... ?>
                const gt = xml.indexOf('>', i);
                i = gt < 0 ? len : gt + 1;
                continue;
            }

            if (c === BANG) {
                // comment, CDATA or doctype
                if (xml.charCodeAt(i + 1) === 45 && xml.charCodeAt(i + 2) === 45) {
                    const end = xml.indexOf('-->', i + 3);
                    i = end < 0 ? len : end + 3;
                } else {
                    const gt = xml.indexOf('>', i);
                    i = gt < 0 ? len : gt + 1;
                }
                continue;
            }

            // opening tag: read the tag name
            let j = i;
            while (j < len) {
                const ch = xml.charCodeAt(j);
                if (isSpace(ch) || ch === SLASH || ch === GT) {
                    break;
                }
                j++;
            }
            const tag = xml.slice(i, j);
            const node: { [k: string]: any } = { $tag: tag };

            // parse attributes up to the closing '>' (quote-aware)
            let selfClose = false;
            while (j < len) {
                let ch = xml.charCodeAt(j);
                while (isSpace(ch)) {
                    ch = xml.charCodeAt(++j);
                }
                if (ch === GT) {
                    j++;
                    break;
                }
                if (ch === SLASH) {
                    selfClose = true;
                    j++;
                    continue;
                }

                const nameStart = j;
                while (j < len) {
                    ch = xml.charCodeAt(j);
                    if (ch === EQUALS || isSpace(ch) || ch === GT || ch === SLASH) {
                        break;
                    }
                    j++;
                }
                const attrName = xml.slice(nameStart, j);

                while (isSpace(xml.charCodeAt(j))) {
                    j++;
                }
                if (xml.charCodeAt(j) === EQUALS) {
                    j++;
                    while (isSpace(xml.charCodeAt(j))) {
                        j++;
                    }
                    const q = xml.charCodeAt(j);
                    if (q === DQUOTE || q === SQUOTE) {
                        j++;
                        let valEnd = xml.indexOf(q === DQUOTE ? '"' : "'", j);
                        if (valEnd < 0) {
                            valEnd = len;
                        }
                        node[attrName] = xml.slice(j, valEnd);
                        j = valEnd + 1;
                    }
                } else if (attrName) {
                    node[attrName] = '';
                }
            }
            i = j;

            const fullTag = top ? top.fullTag + '.' + tag : (basePath ? basePath + '.' + tag : tag);
            const parentNode = top ? top.node : undefined;

            if (queryParent && parentNode) {
                parentMap.set(node, parentNode);
            }

            // '?'/'!' prefixed tags were already routed above; treat trailing
            // '/' (and the implicitly self-closing prolog tags) as leaves.
            if (selfClose) {
                if (progressive) {
                    if (hasOpenListeners) {
                        this.emit('<' + fullTag + '>', node, parentNode);
                    }
                    this.emit('</' + fullTag + '>', node, parentNode);
                }
                if (parentNode) {
                    const inner = parentNode.$innerNodes;
                    if (inner) {
                        inner.push(node);
                    } else {
                        parentNode.$innerNodes = [node];
                    }
                } else {
                    roots.push(node);
                }
                continue;
            }

            if (hasOpenListeners) {
                this.emit('<' + fullTag + '>', node, parentNode);
            }
            const frame: Frame = { node, fullTag, textStart: i };
            stack.push(frame);
            top = frame;
        }

        return roots;
    }

    public getParent(node: any): any {
        if (this.queryParent) {
            return this.parentMap.get(node);
        }
        return null;
    }

    /**
     * Register a listener for an event. The event may carry a trailing
     * JavaScript condition (`<path[expr]>`) that must evaluate truthy on the
     * node for the listener to fire.
     */
    public addListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        if (conditioned(evt)) {
            const ev = parseEvent(evt);
            if (ev.exp) {
                (func as { [k: string]: any }).condition = genConditionFunc(ev.exp);
            }
            evt = ev.evt;
        }
        this.$addListener(evt, func);
    }

    public removeListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        if (conditioned(evt)) {
            const ev = parseEvent(evt);
            evt = ev.evt;
        }
        this.$removeListener(evt, func);
    }

    public on(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        this.addListener(evt, func);
    }

    public off(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        this.removeListener(evt, func);
    }

    private $addListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        const funcs = this.evtListeners[evt];
        if (funcs) {
            funcs.push(func);
        } else {
            this.evtListeners[evt] = [func];
        }
        // open-tag events look like `<path>`; close-tag events like `</path>`.
        if (evt.charCodeAt(1) !== SLASH) {
            this.openListenerCount++;
        }
    }

    private $removeListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        const funcs = this.evtListeners[evt];
        let idx = -1;
        if (funcs) {
            idx = funcs.indexOf(func);
        }
        if (idx >= 0) {
            funcs.splice(idx, 1);
            if (evt.charCodeAt(1) !== SLASH) {
                this.openListenerCount--;
            }
        }
    }

    private emit(evt: string, node: { [k: string]: any }, parentNode?: { [k: string]: any }) {
        const funcs = this.evtListeners[evt];
        if (funcs) {
            for (const func of funcs) {
                if (func.condition) {
                    if (func.condition(node, parentNode) === true) {
                        func(node, parentNode);
                    }
                } else {
                    func(node, parentNode);
                }
            }
        }
    }
}
