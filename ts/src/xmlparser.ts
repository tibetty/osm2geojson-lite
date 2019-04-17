function conditioned(evt: string): boolean {
	return evt.match(/^(.+?)\[(.+?)\]>$/g) != null;
}

function parseEvent(evt: string): {evt: string, exp?: string} {
	let match = /^(.+?)\[(.+?)\]>$/g.exec(evt);
	if (match)
		return {evt: match[1] + '>', exp: match[2]};
	return {evt};
}

function genConditionFunc(cond: string): Function {
	let body = 'return ' + cond.replace(/(\$.+?)(?=[=!.])/g, 'node.$&') + ';';
	return new Function('node', body);
}

export default class {
	queryParent: boolean;
	progressive: boolean;
	parentMap: WeakMap<any, any>;
	evtListeners: {[k: string]: any};

	constructor(opts: any) {
		if (opts) {
			this.queryParent = opts.queryParent? true : false;
			this.progressive = opts.progressive;
			if (this.queryParent) this.parentMap = new WeakMap();
		}
		this.evtListeners = {};
	}

	parse(xml: string, parent?: any, dir?: string) {
		dir = dir? dir + '.' : '';
		let nodeRegEx = /<([^ >\/]+)(.*?)>/mg, nodeMatch: any = null, nodes: any[] = [];
		while (nodeMatch = nodeRegEx.exec(xml)) {
			let tag = nodeMatch[1], node: {[k: string]: any} = {$tag: tag}, fullTag = dir + tag; 

			let attrText = nodeMatch[2].trim(), closed = false;
			if (attrText.endsWith('/') || tag.startsWith('?') || tag.startsWith('!')) {
				closed = true;
			}

			let attRegEx1 = /([^ ]+?)="(.+?)"/g, attRegEx2 = /([^ ]+?)='(.+?)'/g;
			let attMatch: any = null, hasAttrs: boolean = false;
			while (attMatch = attRegEx1.exec(attrText)) {
				hasAttrs = true;
				node[attMatch[1]] = attMatch[2];
			}
			if (!hasAttrs)
				while (attMatch = attRegEx2.exec(attrText)) {
					hasAttrs = true;
					node[attMatch[1]] = attMatch[2];
				}

			if (!hasAttrs && attrText !== '') node.text = attrText;
			if (this.progressive) this.emit(`<${fullTag}>`, node, parent);


			if (!closed) {
				let innerRegEx = new RegExp(`([^]+?)<\/${tag}>`, 'g');
				innerRegEx.lastIndex = nodeRegEx.lastIndex;
				let innerMatch = innerRegEx.exec(xml);
				if (innerMatch && innerMatch[1]) {
					nodeRegEx.lastIndex = innerRegEx.lastIndex;
					let innerNodes = this.parse(innerMatch[1], node, fullTag);
					if (innerNodes.length > 0) node.$innerNodes = innerNodes;
					else node.$innerText = innerMatch[1];
				}
			}
			if (this.queryParent && parent) {
				this.parentMap.set(node, parent);
			}

			if (this.progressive) this.emit(`</${fullTag}>`, node, parent);

			nodes.push(node);
		}

		return nodes;
	}

	getParent(node: any): any {
		if (this.queryParent)
			return this.parentMap.get(node);
		return null;
	}

	$addListener(evt: string, func: Function) {
		let funcs = this.evtListeners[evt];
		if (funcs) funcs.push(func);
		else this.evtListeners[evt] = [func];
	}

	// support javascript condition for the last tag
	addListener(evt: string, func: Function) {
		if (conditioned(evt)) {
			// func.prototype = evt;
			let ev = parseEvent(evt);
			if (ev.exp)	(<{[k: string]: any}>func).condition = genConditionFunc(ev.exp);
			evt = ev.evt;
		}
		this.$addListener(evt, func);
	}

	$removeListener(evt: string, func: Function) {
		let funcs = this.evtListeners[evt];
		let idx = null;
		if (funcs && (idx = funcs.indexOf(func)) >= 0)
			funcs.splice(idx, 1);
	}

	removeListener(evt: string, func: Function) {
		if (conditioned(evt)) {
			let ev = parseEvent(evt);
			evt = ev.evt;
		}
		this.$removeListener(evt, func);
	}

	emit(evt: string, ...args) {
		let funcs = this.evtListeners[evt];
		if (funcs) {
			for (let func of funcs) {
				if (func.condition) {
					if (func.condition.apply(null, args) === true)
						func.apply(null, args);
				} else 
					func.apply(null, args);
			}
		}
	}

	on(evt: string, func: Function) {
		this.addListener(evt, func);
	}

	off(evt: string, func: Function) {
		this.removeListener(evt, func);
	}
}