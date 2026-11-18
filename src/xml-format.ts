import { parseOsmXmlElements } from './osm-xml';
import { analyzeElements } from './element-analyze';
import type { Reader } from './reader';

/**
 * OSM XML documents and osmChange diffs. The scanner emits the same element
 * objects as the JSON and PBF readers, so every format shares one history
 * resolution and one registration path.
 */
export const xmlReader: Reader = {
    analyze(input, refElements) {
        analyzeElements({ elements: parseOsmXmlElements(input) }, refElements);
    },
    read(input) {
        return parseOsmXmlElements(input);
    },
};
