import { createEntry } from './engine';
import { xmlReader } from './xml-format';
import { jsonReader } from './json-format';
import { pbfReader } from './pbf-format';

/**
 * The default entry reads every supported format and detects it from the input.
 * Import `osm2geojson-lite/xml`, `/json` or `/pbf` when the format is known and
 * a bundle without the other parsers matters.
 */
const entry = createEntry({ xml: xmlReader, json: jsonReader, pbf: pbfReader }, 'osm2geojson-lite');

export default entry.osm2geojson;
export const toElements = entry.toElements;
export const mergeOsmChange = entry.mergeOsmChange;
export const applyOsmChange = entry.applyOsmChange;

export type { IOptions, AppliedChange } from './engine';
export type { MergeConflict, MergedDocument } from './elements';
export type { OsmInput } from './reader';
