import type { RefElements } from './ref-elements';
import type { Feature } from 'geojson';

export abstract class OsmObject {
    public refCount: number;
    public hasTag: boolean;
    public id: string;
    /** Set when a referenced node, way or relation could not be resolved. */
    public tainted: boolean;

    protected refElems: RefElements;

    private type: string;
    protected tags: { [k: string]: string };
    private props: { [k: string]: any };

    constructor(type: string, id: string, refElems: RefElements, register: boolean = true) {
        this.type = type;
        this.id = id;
        this.refElems = refElems;
        this.tags = {};
        this.props = { id: this.getCompositeId() };
        this.refCount = 0;
        this.hasTag = false;
        this.tainted = false;
        if (refElems && register) {
            refElems.add(this.getCompositeId(), this);
        }
    }

    public addTags(tags: { [k: string]: string }) {
        this.tags = Object.assign(this.tags, tags);
        this.hasTag = true;
    }

    public addTag(k: string, v: string) {
        this.tags[k] = v;
        this.hasTag = true;
    }

    public addProp(k: string, v: any) {
        this.props[k] = v;
    }

    public addProps(props: { [k: string]: any }) {
        this.props = Object.assign(this.props, props);
    }

    public getCompositeId(): string {
        return `${this.type}/${this.id}`;
    }

    public getProps(): { [k: string]: any } {
        const props = Object.assign({}, this.props, this.tags);
        if (this.tainted && this.refElems && this.refElems.reportTainted) {
            props['@tainted'] = true;
        }
        return props;
    }

    public abstract toFeatureArray(): Array<Feature<any, any>>;
}
