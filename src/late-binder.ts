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

    public resolve(): T | undefined {
        return this.valueFunc.apply(this.ctx, this.args);
    }

    public getContainer(): (T | LateBinder<T>)[] {
        return this.container;
    }
}
