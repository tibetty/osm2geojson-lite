const XML_ENTITY = /&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;

/**
 * Decode the XML entities that occur in OSM data. The cheap `indexOf` check
 * keeps the common case (no entities) allocation-free.
 */
export function decodeEntities(value: string): string {
    if (value.indexOf('&') < 0) {
        return value;
    }
    return value.replace(XML_ENTITY, (match, entity: string) => {
        switch (entity) {
            case 'amp': return '&';
            case 'lt': return '<';
            case 'gt': return '>';
            case 'quot': return '"';
            case 'apos': return "'";
        }
        if (entity.charCodeAt(0) === 35) { // '#'
            const hex = entity.charCodeAt(1) === 120 || entity.charCodeAt(1) === 88; // 'x' or 'X'
            const code = hex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            if (Number.isFinite(code) && code >= 0 && code <= 0x10FFFF) {
                return String.fromCodePoint(code);
            }
        }
        return match;
    });
}
