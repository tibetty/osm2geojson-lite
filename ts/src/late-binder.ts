export class LateBinder {
    private container: any[] | { [k: string]: any };
    private valueFunc: (...args: any[]) => any;
    private ctx: any;
    private args: any[];

    constructor(container: any[] | { [k: string]: any }, valueFunc: (...args: any[]) => any, ctx: any, args: any[]) {
        this.container = container;
        this.valueFunc = valueFunc;
        this.ctx = ctx;
        this.args = args;
    }

    public bind() {
        const v = this.valueFunc.apply(this.ctx, this.args);
        if (this.container instanceof Array) {
            const idx = this.container.indexOf(this);
            if (idx >= 0) {
                const args: [number, number, any?] = [idx, 1];
                if (v) {
                    args.push(v);
                }
                Array.prototype.splice.apply(this.container, args);
            }
        } else if (typeof this.container === 'object' && !Array.isArray(this.container)) {
            const container = this.container as { [k: string]: any };
            const k = Object.keys(container).find((nv) => container[nv] === this);
            if (k) {
                if (v) {
                    container[k] = v;
                } else {
                    delete container[k];
                }
            }
        }
    }
}