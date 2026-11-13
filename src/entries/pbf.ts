import { createEntry } from '../engine';
import { pbfReader } from '../pbf-format';

/**
 * pbf input only. The default `osm2geojson-lite` entry detects the format
 * instead and carries every parser; this entry leaves the others out of the
 * bundle. Mixed formats (for example a PBF base with an osmChange diff) need
 * the default entry.
 */
const entry = createEntry({ pbf: pbfReader }, 'osm2geojson-lite/pbf');

export default entry.osm2geojson;
export const toElements = entry.toElements;
export const mergeOsmChange = entry.mergeOsmChange;
export const applyOsmChange = entry.applyOsmChange;

export type { IOptions, AppliedChange } from '../engine';
export type { MergeConflict, MergedDocument } from '../elements';
export type { OsmInput } from '../reader';
