var test = require('tape')
var fs = require('fs')
var path = require('path')

var conv = require('../index.js')


test('somes.pbf', function(t) {
  var input = fs.readFileSync(path.join(__dirname, './somes.pbf'))
  var expected = require('./somes.json')

  t.plan(expected.length)
  var output = conv(input)

  output.elements.forEach(function(e) {
    if (expected[0].lat) { expected[0].lat = Math.round(expected[0].lat*1E8)/1E8; e.lat = Math.round(e.lat*1E8)/1E8 }
    if (expected[0].lon) { expected[0].lon = Math.round(expected[0].lon*1E8)/1E8; e.lon = Math.round(e.lon*1E8)/1E8 }
    t.deepEqual(e, expected.shift())
  })
})

test('manyNodes.pbf', function(t) {
  var input = fs.readFileSync(path.join(__dirname, './manyNodes.pbf'))

  t.plan(1)
  var output = conv(input)

  t.equal(output.elements.length, 3000)
})

test('test.pbf', function(t) {
  var input = fs.readFileSync(path.join(__dirname, './test.pbf'))

  t.plan(23)
  var output = conv(input)

  var nodes = output.elements.filter(function(o) { return o.type === 'node' })
  t.equal(Math.round(nodes[0].lat*1E8)/1E8, 51.5074089)
  t.equal(Math.round(nodes[0].lon*1E8)/1E8, -0.1080108)
  t.equal(nodes[0].id, 319408586)
  t.equal(nodes[0].timestamp, '2008-12-17T01:18:42Z')
  t.equal(Math.round(nodes[1].lat*1E8)/1E8, 51.5074343)
  t.equal(Math.round(nodes[1].lon*1E8)/1E8, -0.1081264)
  t.equal(nodes[1].id, 319408587)
  t.equal(nodes[2].tags['amenity'], 'cafe')
  t.equal(Math.round(nodes[nodes.length-1].lat*1E8)/1E8, 51.507406)
  t.equal(Math.round(nodes[nodes.length-1].lon*1E8)/1E8, -0.1083348)
  t.equal(nodes[nodes.length-1].tags !== undefined, true)
  var ways = output.elements.filter(function(o) { return o.type === 'way' })
  t.equal(ways[0].id, 27776903)
  t.equal(ways[0].version, 3)
  t.equal(ways[0].timestamp, '2009-05-31T13:39:15Z')
  t.equal(ways[0].changeset, 1368552)
  t.equal(ways[0].user, 'Matt')
  t.equal(ways[0].uid, 70)
  t.equal(ways[0].tags['highway'], 'service')
  t.equal(ways[0].tags['name'], 'üßé€')
  t.equal(ways[0].nodes[0], 304994979)
  t.equal(ways[0].nodes[1], 319408587)
  var rels = output.elements.filter(function(o) { return o.type === 'relation' })
  t.equal(rels.length, 1)
  t.equal(rels[0].id, 56688)
})

test('custom handler', function(t) {
  var input = fs.readFileSync(path.join(__dirname, './somes.pbf'))

  t.plan(2)

  var count = 0
  var last
  var output = conv(input, function(element) {
    count++
    last = element
  })

  t.equal(count, 1577)
  t.equal(last.type, "relation")
})

test('header data', function(t) {
  var input = fs.readFileSync(path.join(__dirname, './somes.pbf'))

  t.plan(4)

  var output = conv(input)

  t.equal(output.generator, "0.43.1")
  t.equal(output.osm3s.copyright, "http://www.openstreetmap.org/api/0.6")
  //t.equal(output.osm3s.timestamp_osm_base, "1970-01-01T00:00:00Z") // todo: find test data with actual date set
  t.equal(Math.round(1E6*output.bounds.minlat), Math.round(1E6*-41.264194819))
  t.equal(Math.round(1E6*output.bounds.maxlon), Math.round(1E6*174.870800971))
})
