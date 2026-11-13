import { parseOsmXml, parseOsmXmlElements } from './osm-xml';
import type { Reader } from './reader';

/** OSM XML documents and osmChange diffs (they share the scanner). */
export const xmlReader: Reader = {
    analyze(input, refElements) {
        parseOsmXml(input, refElements);
    },
    read(input) {
        return parseOsmXmlElements(input);
    },
};
