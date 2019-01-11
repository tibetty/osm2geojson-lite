* Use `pbf` command to generate .js parsers, see https://github.com/mapbox/pbf#using-compiled-code
* Manual modification in `osmformat.js` needed: change default value of `visible` flag to `undefined` (from `false`) to fit [osmpbf specs](https://wiki.openstreetmap.org/wiki/PBF_Format) which are strictly speaking incompatible with Proto3 semantics. But whatever! Here's an example patch:

```diff
diff --git a/proto/osmformat.js b/proto/osmformat.js
index 258fe52..c9e7399 100644
--- a/proto/osmformat.js
+++ b/proto/osmformat.js
@@ -113,7 +113,7 @@ StringTable.write = function (obj, pbf) {
 var Info = exports.Info = {};
 
 Info.read = function (pbf, end) {
-    return pbf.readFields(Info._readField, {version: 0, timestamp: 0, changeset: 0, uid: 0, user_sid: 0, visible: false}, end);
+    return pbf.readFields(Info._readField, {version: 0, timestamp: 0, changeset: 0, uid: 0, user_sid: 0, visible: undefined}, end);
 };
 Info._readField = function (tag, obj, pbf) {
     if (tag === 1) obj.version = pbf.readVarint(true);
```
