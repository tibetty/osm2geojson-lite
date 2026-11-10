export class LateBinder<T> {
    private container: (T | LateBinder<T>)[];
    private valueFunc: (...args: any[]) => T | undefined;
    private ctx: any;
    private args: any[];
    private roleContainer?: string[];
    private roleValue: string;

    constructor(container: (T | LateBinder<T>)[], valueFunc: (...args: any[]) => T | undefined, ctx: any, args: any[], roleContainer?: string[], roleValue: string = '') {
        this.container = container;
        this.valueFunc = valueFunc;
        this.ctx = ctx;
        this.args = args;
        this.roleContainer = roleContainer;
        this.roleValue = roleValue;
    }

    public resolve(): T | undefined {
        return this.valueFunc.apply(this.ctx, this.args);
    }

    public getContainer(): (T | LateBinder<T>)[] {
        return this.container;
    }

    public getOwner(): any {
        return this.ctx;
    }

    public getRoleContainer(): string[] | undefined {
        return this.roleContainer;
    }

    public getRole(): string {
        return this.roleValue;
    }
}
