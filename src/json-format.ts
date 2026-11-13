import { analyzeElements } from './element-analyze';
import type { Reader } from './reader';

/**
 * OSM/Overpass JSON, as an object or a JSON string. The engine parses the
 * string before it gets here, so `input` is always an element document.
 */
export const jsonReader: Reader = {
    analyze(input, refElements) {
        if (input && Array.isArray(input.elements)) {
            analyzeElements(input, refElements);
        }
    },
    read(input) {
        const elements = input && input.elements;
        return Array.isArray(elements) ? elements : [];
    },
};
