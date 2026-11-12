import type { RefElements } from './ref-elements';
import type { Feature } from 'geojson';

export abstract class OsmObject {
    public refCount: number;
    public hasTag: boolean;
    public id: string;
    /** Set when a referenced node, way or relation could not be resolved. */
    public tainted: boolean;
    /** Position in the owning RefElements registration order; internal. */
    public orderIndex: number;

    protected refElems: RefElements;

    private type: string;
    private compositeId: string;
    protected tags: { [k: string]: string };
    private props: { [k: string]: any };

    constructor(type: string, id: string, refElems: RefElements, register: boolean = true) {
        this.type = type;
        this.id = id;
        this.refElems = refElems;
        this.tags = {};
        this.compositeId = `${type}/${id}`;
        this.props = { id: this.compositeId };
        this.refCount = 0;
        this.hasTag = false;
        this.tainted = false;
        this.orderIndex = -1;
        if (refElems && register) {
            refElems.add(this);
        }
    }

    /**
     * Tags also land in `props`, which is what a feature exposes. Merging them
     * per feature at output time allocated one object per feature; copying them
     * here allocates nothing, and `getProps` can hand the object out as-is.
     */
    public addTags(tags: { [k: string]: string }) {
        this.tags = Object.assign(this.tags, tags);
        Object.assign(this.props, tags);
        this.hasTag = true;
    }

    public addTag(k: string, v: string) {
        this.tags[k] = v;
        this.props[k] = v;
        this.hasTag = true;
    }

    public addProp(k: string, v: any) {
        this.props[k] = v;
    }

    public addProps(props: { [k: string]: any }) {
        this.props = Object.assign(this.props, props);
    }

    /**
     * Adopt a props object built for this element, without copying it again.
     * `props.id` must already be the composite id (see `purgeProps(…, seed)`).
     */
    public setProps(props: { [k: string]: any }) {
        // Normally called before addTags; merge only if tags already arrived.
        this.props = this.hasTag ? Object.assign(props, this.tags) : props;
    }

    /**
     * Merge another copy of the same element into this one. The newest version
     * wins; missing tags/props from the older copy are preserved.
     */
    public mergeFrom(other: OsmObject): void {
        const thisVersion = Number(this.props.version) || 0;
        const otherVersion = Number(other.props.version) || 0;
        if (otherVersion > thisVersion) {
            this.props = { ...this.props, ...other.props };
            this.tags = { ...this.tags, ...other.tags };
        } else {
            this.props = { ...other.props, ...this.props };
            this.tags = { ...other.tags, ...this.tags };
        }
        this.hasTag = this.hasTag || other.hasTag;
        this.tainted = this.tainted || other.tainted;
        this.refCount = Math.max(this.refCount, other.refCount);
    }

    public getCompositeId(): string {
        return this.compositeId;
    }

    public getVersion(): number {
        return Number(this.props.version) || 0;
    }

    public getProps(): { [k: string]: any } {
        if (this.tainted && this.refElems && this.refElems.reportTainted) {
            return Object.assign({}, this.props, { '@tainted': true });
        }
        return this.props;
    }

    public abstract toFeatureArray(): Array<Feature<any, any>>;
}
