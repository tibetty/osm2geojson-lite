import type { RefElements } from './ref-elements';
import type { Feature } from 'geojson';

export abstract class OsmObject {
    public refCount: number;

    protected refElems: RefElements;

    private type: string;
    private id: string;
    private tags: { [k: string]: string };
    private props: { [k: string]: string };

    constructor(type: string, id: string, refElems: RefElements) {
        this.type = type;
        this.id = id;
        this.refElems = refElems;
        this.tags = {};
        this.props = { id: this.getCompositeId() };
        this.refCount = 0;
        if (refElems) {
            refElems.add(this.getCompositeId(), this);
        }
    }

    public addTags(tags: { [k: string]: string }) {
        this.tags = Object.assign(this.tags, tags);
    }

    public addTag(k: string, v: string) {
        this.tags[k] = v;
    }

    public addProp(k: string, v: any) {
        this.props[k] = v;
    }

    public addProps(props: { [k: string]: string }) {
        this.props = Object.assign(this.props, props);
    }

    public getCompositeId(): string {
        return `${this.type}/${this.id}`;
    }

    public getProps(): { [k: string]: string } {
        return Object.assign(this.props, this.tags);
    }

    public toFeatureArray(): Array<Feature<any, any>> {
        return [];
    }
}





