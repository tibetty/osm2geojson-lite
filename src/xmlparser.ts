function conditioned(evt: string): boolean {
    return evt.match(/^(.+?)\[(.+?)\]>$/g) !== null;
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

export class XmlParser {
    private queryParent: boolean = false;
    private progressive: boolean = false;
    private parentMap: WeakMap<any, any> = new WeakMap();
    private evtListeners: { [k: string]: any };

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

    public parse(xml: string, parent?: any, dir?: string) {
        dir = dir ? dir + '.' : '';

        const nodeRegEx = /<([^ >\/]+)(.*?)>/mg;
        const nodes: any[] = [];

        let nodeMatch = nodeRegEx.exec(xml);
        while (nodeMatch) {
            const tag = nodeMatch[1];
            const node: { [k: string]: any } = { $tag: tag };
            const fullTag = dir + tag;

            const attrText = nodeMatch[2].trim();
            let closed = false;

            if (attrText.endsWith('/') || tag.startsWith('?') || tag.startsWith('!')) {
                closed = true;
            }

            const attRegEx1 = /([^ ]+?)="(.+?)"/g;
            const attRegEx2 = /([^ ]+?)='(.+?)'/g;
            let attMatch = attRegEx1.exec(attrText);
            let hasAttrs = false;

            while (attMatch) {
                hasAttrs = true;
                node[attMatch[1]] = attMatch[2];
                attMatch = attRegEx1.exec(attrText);
            }

            if (!hasAttrs) {
                attMatch = attRegEx2.exec(attrText);
                while (attMatch) {
                    hasAttrs = true;
                    node[attMatch[1]] = attMatch[2];
                    attMatch = attRegEx2.exec(attrText);
                }
            }

            if (!hasAttrs && attrText !== '') {
                node.text = attrText;
            }

            if (this.progressive) {
                this.emit(`<${fullTag}>`, node, parent);
            }

            if (!closed) {
                const innerRegEx = new RegExp(`([^]+?)<\/${tag}>`, 'g');
                innerRegEx.lastIndex = nodeRegEx.lastIndex;
                const innerMatch = innerRegEx.exec(xml);
                if (innerMatch && innerMatch[1]) {
                    nodeRegEx.lastIndex = innerRegEx.lastIndex;
                    const innerNodes = this.parse(innerMatch[1], node, fullTag);
                    if (innerNodes.length > 0) {
                        node.$innerNodes = innerNodes;
                    } else {
                        node.$innerText = innerMatch[1];
                    }
                }
            }
            if (this.queryParent && parent) {
                this.parentMap.set(node, parent);
            }

            if (this.progressive) {
                this.emit(`</${fullTag}>`, node, parent);
            }

            nodes.push(node);
            nodeMatch = nodeRegEx.exec(xml);
        }

        return nodes;
    }

    public getParent(node: any): any {
        if (this.queryParent) {
            return this.parentMap.get(node);
        }
        return null;
    }

    // support javascript condition for the last tag
    public addListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        if (conditioned(evt)) {
            // func.prototype = evt;
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
    }

    private $removeListener(evt: string, func: (node: { [k: string]: any }, parent?: { [k: string]: any }) => void) {
        const funcs = this.evtListeners[evt];
        let idx = -1;
        if (funcs) {
            idx = funcs.indexOf(func);
        }
        if (idx >= 0) {
            funcs.splice(idx, 1);
        }
    }

    private emit(evt: string, ...args: any[]) {
        const funcs = this.evtListeners[evt];
        if (funcs) {
            for (const func of funcs) {
                if (func.condition) {
                    if (func.condition.apply(null, args) === true) {
                        func.apply(null, args);
                    }
                } else {
                    func.apply(null, args);
                }
            }
        }
    }
}
