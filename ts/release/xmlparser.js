"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function conditioned(evt) {
    return evt.match(/^(.+?)\[(.+?)\]>$/g) !== null;
}
function parseEvent(evt) {
    const match = /^(.+?)\[(.+?)\]>$/g.exec(evt);
    if (match) {
        return { evt: match[1] + '>', exp: match[2] };
    }
    return { evt };
}
function genConditionFunc(cond) {
    const body = 'return ' + cond.replace(/(\$.+?)(?=[=!.])/g, 'node.$&') + ';';
    return new Function('node', body);
}
class default_1 {
    constructor(opts) {
        if (opts) {
            this.queryParent = opts.queryParent ? true : false;
            this.progressive = opts.progressive;
            if (this.queryParent) {
                this.parentMap = new WeakMap();
            }
        }
        this.evtListeners = {};
    }
    parse(xml, parent, dir) {
        dir = dir ? dir + '.' : '';
        const nodeRegEx = /<([^ >\/]+)(.*?)>/mg;
        const nodes = [];
        let nodeMatch = nodeRegEx.exec(xml);
        while (nodeMatch) {
            const tag = nodeMatch[1];
            const node = { $tag: tag };
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
                    }
                    else {
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
    getParent(node) {
        if (this.queryParent) {
            return this.parentMap.get(node);
        }
        return null;
    }
    // support javascript condition for the last tag
    addListener(evt, func) {
        if (conditioned(evt)) {
            // func.prototype = evt;
            const ev = parseEvent(evt);
            if (ev.exp) {
                func.condition = genConditionFunc(ev.exp);
            }
            evt = ev.evt;
        }
        this.$addListener(evt, func);
    }
    removeListener(evt, func) {
        if (conditioned(evt)) {
            const ev = parseEvent(evt);
            evt = ev.evt;
        }
        this.$removeListener(evt, func);
    }
    on(evt, func) {
        this.addListener(evt, func);
    }
    off(evt, func) {
        this.removeListener(evt, func);
    }
    $addListener(evt, func) {
        const funcs = this.evtListeners[evt];
        if (funcs) {
            funcs.push(func);
        }
        else {
            this.evtListeners[evt] = [func];
        }
    }
    $removeListener(evt, func) {
        const funcs = this.evtListeners[evt];
        let idx = -1;
        if (funcs) {
            idx = funcs.indexOf(func);
        }
        if (idx >= 0) {
            funcs.splice(idx, 1);
        }
    }
    emit(evt, ...args) {
        const funcs = this.evtListeners[evt];
        if (funcs) {
            for (const func of funcs) {
                if (func.condition) {
                    if (func.condition.apply(null, args) === true) {
                        func.apply(null, args);
                    }
                }
                else {
                    func.apply(null, args);
                }
            }
        }
    }
}
exports.default = default_1;
