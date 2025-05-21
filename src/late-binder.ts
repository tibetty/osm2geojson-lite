export class LateBinder<T> {
    private container: (T | LateBinder<T>)[];
    private valueFunc: (...args: any[]) => T | undefined;
    private ctx: any;
    private args: any[];

    constructor(container: (T | LateBinder<T>)[], valueFunc: (...args: any[]) => T | undefined, ctx: any, args: any[]) {
        this.container = container;
        this.valueFunc = valueFunc;
        this.ctx = ctx;
        this.args = args;
    }

    public bind() {
        const v = this.valueFunc.apply(this.ctx, this.args);
        const idx = this.container.indexOf(this);
        if (idx < 0) {
            return;
        }
        const args: [number, number, any?] = [idx, 1];
        if (v) {
            args.push(v);
        }
        Array.prototype.splice.apply(this.container, args);
    }
}