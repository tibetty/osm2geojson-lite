var inflate = require('tiny-inflate')
var Pbf = require('pbf')
var FileFormat = require('./proto/fileformat.js')
var OsmFormat = require('./proto/osmformat.js')

var memberTypes = {
  0: 'node',
  1: 'way',
  2: 'relation'
}

var supportedFeatures = {
  "OsmSchema-V0.6": true,
  "DenseNodes": true,
  "HistoricalInformation": true
}


// extracts and decompresses a data blob
function extractBlobData(blob) {
  // todo: add tests for non-zlib cases
  switch (true) {
    // error cases:

    // * lzma compressed data (support for this kind of data is not required by the specs)
    case blob.lzma_data !== null:
      throw new Error("unsupported osmpbf blob data type: lzma_data")
    // * formerly used for bzip2 compressed data, deprecated since 2010
    case blob.OBSOLETE_bzip2_data !== null:
      throw new Error("unsupported osmpbf blob data type: OBSOLETE_bzip2_data")
    // * empty data blob??
    default:
      throw new Error("unsupported osmpbf blob data type: <empty blob>")

    // supported data formats:

    // * uncompressed data
    case blob.raw !== null:
      return blob.raw
    // * zlib "deflate" compressed data
    case blob.zlib_data !== null:
      var blobData = new Buffer(blob.raw_size)
      inflate(blob.zlib_data.slice(2), blobData)
      return blobData
  }
}

module.exports = function(input, handler) {
  var elements = undefined
  if (handler === undefined) {
    var elements = []
    handler = function(element) {
      elements.push(element)
    }
  }

  var blobHeaderLength, blobHeader, blob, blobData

  pbf = new Pbf(input)

  blobHeaderLength = new DataView(new Uint8Array(input).buffer).getInt32(pbf.pos, false)

  pbf.pos += 4
  pbf.length = pbf.pos + blobHeaderLength
  blobHeader = FileFormat.BlobHeader.read(pbf)

  //console.error(blobHeader)

  pbf.pos = pbf.length
  pbf.length = pbf.pos + blobHeader.datasize
  blob = FileFormat.Blob.read(pbf)

  blobData = extractBlobData(blob)

  var osmHeader = new Pbf(blobData)
  osmHeader = OsmFormat.HeaderBlock.read(osmHeader)

  //console.error(osmHeader)

  // check for required_features
  var missingFeatures = osmHeader.required_features.filter(function(requiredFeature) {
    return !supportedFeatures[requiredFeature]
  })
  if (missingFeatures.length > 0) {
    throw new Error("unsupported required osmpbf feature(s): " + missingFeatures.join(', '))
  }

  // read all data blobs
  while (pbf.pos < input.byteLength) {

    pbf.pos = pbf.length
    blobHeaderLength = new DataView(new Uint8Array(input).buffer).getInt32(pbf.pos, false)
    pbf.pos += 4
    pbf.length = pbf.pos + blobHeaderLength
    blobHeader = FileFormat.BlobHeader.read(pbf)

    pbf.pos = pbf.length
    pbf.length = pbf.pos + blobHeader.datasize
    blob = FileFormat.Blob.read(pbf)

    blobData = extractBlobData(blob)

    var osmData = new Pbf(blobData)
    osmData = OsmFormat.PrimitiveBlock.read(osmData)

    //console.error(osmData)
    //console.error(osmData.primitivegroup[0].dense)

    // unpack stringtable into js object
    var strings = osmData.stringtable.s.map(function(x) {
      return new Buffer(x).toString('utf8')
    })

    // date granularity: set default values if not specified in the pbf file
    osmData.date_granularity = osmData.date_granularity || 1000
    // coordinate granularity: set default, invert and pre-scale to nano-degrees
    if (!osmData.granularity || osmData.granularity === 100)
      osmData.granularity = 1E7
    else
      osmData.granularity = 1E9/osmData.granularity
    // pre-scale lat/lon offsets
    osmData.lat_offset *= 1E-9
    osmData.lon_offset *= 1E-9

    // iterate over all groups of osm objects
    osmData.primitivegroup.forEach(function(p) {
      // each "primitivegroup" can either be a list of changesets,
      switch(true) {
        // error cases:

        // * changesets
        case p.changesets.length > 0:
          throw new Error("unsupported osmpbf primitive group data: changesets")
        // * empty primitivegroup ???
        default:
          throw new Error("unsupported osmpbf primitive group data: <empty primitivegroup>")

        // supported data cases:

        // * list of osm relations
        case p.relations.length > 0:
          for (var i=0; i<p.relations.length; i++) {
            var tags = {}
            for (var j=0; j<p.relations[i].keys.length; j++)
              tags[strings[p.relations[i].keys[j]]] = strings[p.relations[i].vals[j]]
            var members = [], ref = 0
            for (var j=0; j<p.relations[i].memids.length; j++)
              members.push({
                type: memberTypes[p.relations[i].types[j]],
                ref: ref += p.relations[i].memids[j],
                role: strings[p.relations[i].roles_sid[j]]
              })
            var out = {
              type: 'relation',
              id: p.relations[i].id,
              members: members,
              tags: tags
            }
            if (p.relations[i].info !== null) {
              if (p.relations[i].info.version !== 0)   out.version   = p.relations[i].info.version
              if (p.relations[i].info.timestamp !== 0) out.timestamp = new Date(p.relations[i].info.timestamp*osmData.date_granularity).toISOString().substr(0, 19) + 'Z'
              if (p.relations[i].info.changeset !== 0) out.changeset = p.relations[i].info.changeset
              if (p.relations[i].info.uid !== 0)       out.uid       = p.relations[i].info.uid
              if (p.relations[i].info.user_sid !== 0)  out.user      = strings[p.relations[i].info.user_sid]
              if (p.relations[i].info.visible !== undefined) out.visible   = p.relations[i].info.visible
            }
            handler(out)
          }
        break

        // * list of osm ways
        case p.ways.length > 0:
          for (var i=0; i<p.ways.length; i++) {
            var tags = {}
            for (var j=0; j<p.ways[i].keys.length; j++)
              tags[strings[p.ways[i].keys[j]]] = strings[p.ways[i].vals[j]]
            var nodes = [], ref = 0
            for (var j=0; j<p.ways[i].refs.length; j++)
              nodes.push(ref += p.ways[i].refs[j])
            var out = {
              type: 'way',
              id: p.ways[i].id,
              nodes: nodes,
              tags: tags
            }
            if (p.ways[i].info !== null) {
              if (p.ways[i].info.version !== 0)   out.version   = p.ways[i].info.version
              if (p.ways[i].info.timestamp !== 0) out.timestamp = new Date(p.ways[i].info.timestamp*osmData.date_granularity).toISOString().substr(0, 19) + 'Z'
              if (p.ways[i].info.changeset !== 0) out.changeset = p.ways[i].info.changeset
              if (p.ways[i].info.uid !== 0)       out.uid       = p.ways[i].info.uid
              if (p.ways[i].info.user_sid !== 0)  out.user      = strings[p.ways[i].info.user_sid]
              if (p.ways[i].info.visible !== undefined) out.visible   = p.ways[i].info.visible
            }
            handler(out)
          }
        break

        // * list of osm nodes
        case p.nodes.length > 0:
          for (var i=0; i<p.nodes.length; i++) {
            var tags = {}
            for (var j=0; j<p.nodes[i].keys.length; j++)
              tags[strings[p.nodes[i].keys[j]]] = strings[p.nodes[i].vals[j]]
            var out = {
              type: 'node',
              id: p.nodes[i].id,
              lat: osmData.lat_offset + p.nodes[i].lat / osmData.granularity,
              lon: osmData.lon_offset + p.nodes[i].lon / osmData.granularity,
              tags: tags
            }
            if (p.nodes[i].info !== null) {
              if (p.nodes[i].info.version !== 0)   out.version   = p.nodes[i].info.version
              if (p.nodes[i].info.timestamp !== 0) out.timestamp = new Date(p.nodes[i].info.timestamp*osmData.date_granularity).toISOString().substr(0, 19) + 'Z'
              if (p.nodes[i].info.changeset !== 0) out.changeset = p.nodes[i].info.changeset
              if (p.nodes[i].info.uid !== 0)       out.uid       = p.nodes[i].info.uid
              if (p.nodes[i].info.user_sid !== 0)  out.user      = strings[p.nodes[i].info.user_sid]
              if (p.nodes[i].info.visible !== undefined) out.visible   = p.nodes[i].info.visible
            }
            handler(out)
          }
        break

        // * dense list of osm nodes
        case p.dense !== null:
          var id=0,lat=0,lon=0,timestamp=0,changeset=0,uid=0,user=0
          var hasDenseinfo = true
          if (p.dense.denseinfo === null) {
            hasDenseinfo = false
            p.dense.denseinfo = {
              version: [],
              timestamp: [],
              changeset: [],
              uid: [],
              user_sid: [],
              visible: []
            }
          }
          var j=0
          for (var i=0; i<Math.max(p.dense.id.length, p.dense.lat.length); i++) {
            id += p.dense.id[i]
            lat += p.dense.lat[i]
            lon += p.dense.lon[i]
            timestamp += p.dense.denseinfo.timestamp[i]
            changeset += p.dense.denseinfo.changeset[i]
            uid += p.dense.denseinfo.uid[i]
            user += p.dense.denseinfo.user_sid[i]
            var tags = {}
            if (p.dense.keys_vals.length > 0) {
              while (p.dense.keys_vals[j] != 0) {
                tags[strings[p.dense.keys_vals[j]]] = strings[p.dense.keys_vals[j+1]]
                j += 2
              }
              j++
            }
            var out = {
              type: 'node',
              id: id,
              lat: osmData.lat_offset + lat / osmData.granularity,
              lon: osmData.lon_offset + lon / osmData.granularity,
              tags: tags
            }
            if (hasDenseinfo) {
              if (p.dense.denseinfo.version.length > 0)   out.version   = p.dense.denseinfo.version[i]
              if (p.dense.denseinfo.timestamp.length > 0) out.timestamp = new Date(timestamp*osmData.date_granularity).toISOString().substr(0, 19) + 'Z'
              if (p.dense.denseinfo.changeset.length > 0) out.changeset = changeset
              if (p.dense.denseinfo.uid.length > 0)       out.uid       = uid
              if (p.dense.denseinfo.user_sid.length > 0)  out.user      = strings[user]
              if (p.dense.denseinfo.visible.length > 0)   out.visible   = p.dense.denseinfo.visible[i]
            }
            handler(out)
          }
        break
      }
    })

  }

  // return collected data in OSM-JSON format (as used by Overpass API)
  var output = {
    "version": 0.6,
    "generator": osmHeader.writingprogram || "tiny-osmpbf",
  }
  if (osmHeader.source !== "" || osmHeader.osmosis_replication_timestamp !== 0) {
    output.osm3s = {}
    if (osmHeader.source !== "") {
      output.osm3s.copyright = osmHeader.source
    }
    if (osmHeader.osmosis_replication_timestamp !== 0) {
      output.osm3s.timestamp_osm_base = new Date(osmHeader.osmosis_replication_timestamp*1000).toISOString().substr(0, 19) + 'Z'
    }
  }
  if (osmHeader.bbox !== null) {
    output.bounds = {
      "minlat": 1E-9 * osmHeader.bbox.bottom,
      "minlon": 1E-9 * osmHeader.bbox.left,
      "maxlat": 1E-9 * osmHeader.bbox.top,
      "maxlon": 1E-9 * osmHeader.bbox.right
    }
  }
  output.elements = elements
  return output
}
