// Benchmark-only comparison libraries that ship no type declarations.
declare module 'osm2geojson-ultra' {
    const osm2geojson: (osm: string | object, opts?: object) => any;
    export default osm2geojson;
}

declare module 'osmtogeojson' {
    const osmtogeojson: (osm: object, opts?: object) => any;
    export default osmtogeojson;
}
