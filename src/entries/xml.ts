import { createEntry } from '../engine';
import { xmlReader } from '../xml-format';

/**
 * xml input only. The default `osm2geojson-lite` entry detects the format
 * instead and carries every parser; this entry leaves the others out of the
 * bundle. Mixed formats (for example a PBF base with an osmChange diff) need
 * the default entry.
 */
const entry = createEntry({ xml: xmlReader }, 'osm2geojson-lite/xml');

export default entry.osm2geojson;
export const toElements = entry.toElements;
export const mergeOsmChange = entry.mergeOsmChange;
export const applyOsmChange = entry.applyOsmChange;

export type { IOptions, AppliedChange } from '../engine';
export type { MergeConflict, MergedDocument } from '../elements';
export type { OsmInput } from '../reader';
