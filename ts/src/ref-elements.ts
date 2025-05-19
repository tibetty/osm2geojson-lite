import { LateBinder } from "./late-binder";

export class RefElements extends Map {
    private binders: LateBinder[];

    constructor() {
        super();
        this.binders = [];
    }

    public add(k: string, v: any) {
        this.set(k, v);
    }

    public addBinder(binder: LateBinder) {
        this.binders.push(binder);
    }

    public bindAll() {
        this.binders.forEach((binder) => binder.bind());
    }
}