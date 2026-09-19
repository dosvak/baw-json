/*  baw-json.js  -  IBM BPM / Business Automation Workflow business objects <-> JSON, both directions, every type.
 *
 *  Copyright 2026 Dosvak LLC. Licensed under the Apache License, Version 2.0 (see LICENSE and NOTICE); version 1.0.0 was
 *  released into the public domain. NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.
 *
 *  Runs inside the server-side JavaScript (Rhino) of IBM BPM 8.5.x / 8.6, Business Automation Workflow (traditional and containers)
 *  and Cloud Pak for Business Automation Workflow. Install it as a Server File (managed file of type "Server") in a toolkit; every
 *  server script of the process apps that depend on the toolkit can then use the BAWJSON namespace (and BPMJSON for old scripts).
 *  The library makes no network, file, database or reflection calls: it only talks to the engine's own tw.object / tw.system.serializer.
 *
 *  BAW -> JSON
 *      BAWJSON.toJS(value [, options])           TWObject / list / TWDate / Time / Map / Record / XML / Java value -> plain JavaScript value
 *      BAWJSON.toJSON(value [, options])         the same, serialised to a JSON string (options.indent pretty prints)
 *  JSON -> BAW
 *      BAWJSON.parse(text [, options])           JSON string -> plain JavaScript value (ISO dates revived as Date objects by default)
 *      BAWJSON.fromJS(value, type [, options])   plain JavaScript value -> typed BAW value; type = "Order", "Order[]", "String[]", "Date", ...
 *      BAWJSON.fromJSON(text, type [, options])  JSON text -> typed BAW value (unknown properties are skipped, dates converted, numbers checked)
 *      BAWJSON.assign(target, value [, options]) fill an existing business object (for instance tw.local.order) from a plain object / JSON text
 *  Helpers
 *      BAWJSON.typeOf(value)                     "twObject" | "twList" | "twDate" | "map" | "xml" | "date" | "array" | "object" | "java" | "string" | ...
 *      BAWJSON.typeName(value)                   type name of a BAW value: "Order", "Order[]", "String[]", "Date", "Map", ...
 *      BAWJSON.propertyType(typeName, property)  declared type of a business object property ("Date", "OrderItem[]", "ANY", ...; null = not declared)
 *      BAWJSON.copy(value)                       deep copy of a BAW value (same type)
 *      BAWJSON.omit(object, paths) / BAWJSON.pick(object, paths)     drop / keep properties: "a.b.c" paths, "list[].field" for lists, "*" / "**"
 *      BAWJSON.formatDate(date [, format]) / BAWJSON.parseDate(text) ISO 8601 (UTC) formatting and parsing
 *
 *  Options (every function accepts an options object; unset entries take BAWJSON.defaults)
 *      emptyProperties  true     toJS: include properties whose value is null (as null); false = leave them out
 *      emptyLists       true     toJS: include empty lists (as []); false = leave them out
 *      dateFormat       "iso"    toJS: "iso" = 2025-01-15T10:30:00.000Z, "isoSeconds" = 2025-01-15T10:30:00Z, "epoch" = milliseconds,
 *                                "legacy" = 2025-01-15 10:30:00Z (BPMJSON 2.x), "date" = 2025-01-15, or function (nativeDate) -> value
 *      timeFormat       null     toJS: format of Time values (defaults to dateFormat); "time" = HH:mm:ss (UTC)
 *      decimalAs        "number" toJS: "string" keeps big Java decimals exact
 *      xml              "string" toJS: XMLElement / XMLDocument as XML text | "object" = {name, attributes, text | children} | "e4x" = untouched
 *      java             "string" toJS: java.* values (in ANY properties): "string" | "skip" | function (javaObject) -> value
 *      maxDepth         64       recursion guard
 *      cycles           "null"   toJS: a value already on the current path becomes null | "error" = throw | "ref" = {"$ref": "path"}
 *      keyMapper        null     function (name, path) -> new name, or null / "" to skip the property (both directions)
 *      valueMapper      null     toJS: function (convertedValue, path, originalValue) -> replacement value
 *      typeProperty     null     e.g. "$type": toJS adds the BAW type name to every object; fromJS uses it for ANY / Record values
 *      omit / pick      []       toJS: property paths to drop / keep (see BAWJSON.omit / pick)
 *      reviveDates      true     parse: strings that look like ISO 8601 dates become Date objects
 *      types            {}       fromJS: declared property types when they cannot be discovered from the engine:
 *                                { Order: { items: "OrderItem[]", customer: "Customer", created: "Date", extra: "ANY" } }
 *      strict           false    fromJS: true = a property the business object does not declare throws; false = it is skipped
 *      unknownRoot      "Record" fromJS without a type: plain objects become Record, arrays ANY[]
 *      indent           null     toJSON: pretty-print indentation (number of spaces or a string)
 */
var BAWJSON = (function (global) {
    "use strict";

    var VERSION = "1.0.1";
    var toStr = Object.prototype.toString;
    var hasOwn = Object.prototype.hasOwnProperty;

    // ------------------------------------------------------------------ defaults
    var defaults = {
        emptyProperties: true, emptyLists: true, dateFormat: "iso", timeFormat: null, decimalAs: "number", xml: "string", java: "string",
        maxDepth: 64, cycles: "null", keyMapper: null, valueMapper: null, typeProperty: null, omit: [], pick: [],
        reviveDates: true, types: {}, strict: false, unknownRoot: "Record", indent: null
    };

    function settings(options) {
        var o = {}, k;
        for (k in defaults) if (hasOwn.call(defaults, k)) o[k] = defaults[k];
        if (options) for (k in options) if (hasOwn.call(options, k) && options[k] !== undefined) o[k] = options[k];
        if (typeof o.omit === "string") o.omit = o.omit.split(",");
        if (typeof o.pick === "string") o.pick = o.pick.split(",");
        return o;
    }

    function fail(msg) { throw new Error("BAWJSON: " + msg); }

    // ------------------------------------------------------------------ type detection
    function tag(v) { return toStr.call(v).slice(8, -1); }

    function isTWObject(v) { return v !== null && typeof v === "object" && tag(v) === "TWObject"; }
    function isTWList(v) {
        if (!isTWObject(v)) return false;
        try { return typeof v.listLength === "number"; } catch (e) { return false; }   // reading an undeclared property throws
    }
    function isTWDate(v) { return v !== null && typeof v === "object" && tag(v) === "TWDate"; }
    function isTWMap(v) { return v !== null && typeof v === "object" && tag(v) === "tw_object_Map"; }
    function isNativeDate(v) { return tag(v) === "Date"; }
    function isXML(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === "xml") return true;
        var t = tag(v);
        return t === "XML" || t === "XMLList" || t === "TWDElement" || t === "TWDDocument" || t === "TWDNodeList";
    }
    function isJava(v) {
        if (v === null || typeof v !== "object") return false;
        var t = tag(v);
        if (t === "JavaObject" || t === "JavaArray") return true;
        try { return typeof Packages !== "undefined" && v instanceof Packages.java.lang.Object; } catch (e) { return false; }
    }
    function isArray(v) { return tag(v) === "Array"; }
    function isPlainObject(v) { return v !== null && typeof v === "object" && tag(v) === "Object"; }

    /** "null" | "undefined" | "boolean" | "number" | "string" | "function" | "twList" | "twObject" | "twDate" | "map" | "xml" | "date" | "array" | "java" | "object" */
    function typeOf(v) {
        if (v === null) return "null";
        var t = typeof v;
        if (t === "undefined") return "undefined";
        if (t === "boolean" || t === "number" || t === "string" || t === "function") return t;
        if (isXML(v)) return "xml";
        if (isTWList(v)) return "twList";
        if (isTWObject(v)) return "twObject";
        if (isTWDate(v)) return "twDate";
        if (isTWMap(v)) return "map";
        if (isNativeDate(v)) return "date";
        if (isArray(v)) return "array";
        if (isJava(v)) return "java";
        var tg = tag(v);
        if (tg === "String" || tg === "Number" || tg === "Boolean") return tg.toLowerCase();
        return "object";
    }

    // ------------------------------------------------------------------ dates
    function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = "0" + s; return s; }

    function nativeDate(v) {
        if (v === null || v === undefined) return null;
        if (isNativeDate(v)) return v;
        if (isTWDate(v)) { try { return v.toNativeDate(); } catch (e) { return new Date(String(v)); } }
        if (typeof v === "number") return new Date(v);
        if (typeof v === "string") return parseDate(v);
        if (isJava(v) && typeof v.getTime === "function") return new Date(Number(v.getTime()));
        return null;
    }

    /** Text of a date. format: "iso" | "isoSeconds" | "date" | "time" | "epoch" | "legacy" | "engine" | function (Date) -> value */
    function formatDate(v, format) {
        var d = nativeDate(v);
        if (!d || isNaN(d.getTime())) return null;
        if (typeof format === "function") return format(d);
        var day = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
        var time = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
        switch (format || "iso") {
            case "epoch": return d.getTime();
            case "date": return day;
            case "time": return time;
            case "isoSeconds": return day + "T" + time + "Z";
            case "legacy": return day + " " + time + "Z";
            case "engine": return d.getUTCFullYear() + "/" + pad(d.getUTCMonth() + 1) + "/" + pad(d.getUTCDate()) + " " + time + "." + pad(d.getUTCMilliseconds(), 3) + " UTC";
            default: return day + "T" + time + "." + pad(d.getUTCMilliseconds(), 3) + "Z";
        }
    }

    var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
    var ENGINE_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))? ([A-Za-z]{3,4})$/;

    /** Parses ISO 8601 text (date only, date-time, Z or offset, the legacy "yyyy-MM-dd HH:mm:ssZ" form), the engine's own text and epoch numbers. */
    function parseDate(text) {
        if (text === null || text === undefined || text === "") return null;
        if (isNativeDate(text)) return text;
        if (typeof text === "number") return new Date(text);
        var s = String(text), m = ISO_RE.exec(s), utc;
        if (m) {
            var ms = m[7] ? Math.round(Number("0." + m[7]) * 1000) : 0;
            utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms);
            if (m[8] && m[8] !== "Z") {
                var sign = m[8].charAt(0) === "-" ? -1 : 1, hh = +m[8].substring(1, 3), mm = +m[8].replace(":", "").substring(3, 5);
                utc -= sign * (hh * 60 + mm) * 60000;
            } else if (!m[8] && m[4] === undefined) {
                utc += 12 * 3600000;        // date only: noon UTC, so that no time zone shifts the day
            }
            return new Date(utc);
        }
        m = ENGINE_RE.exec(s);
        if (m && (m[8] === "UTC" || m[8] === "GMT")) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +(m[7] + "00").substring(0, 3) : 0));
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    function looksLikeDate(s) { return typeof s === "string" && s.length >= 10 && s.length <= 40 && (ISO_RE.test(s) || ENGINE_RE.test(s)); }

    // ------------------------------------------------------------------ paths (omit / pick)
    function splitRule(p) { var a = String(p).replace(/\[\]/g, ".[]").split("."), r = [], i; for (i = 0; i < a.length; i++) if (a[i] !== "") r.push(a[i]); return r; }
    function segMatches(r, seg) { return r === "*" || r === "**" || (r === "[]" && /^\d+$/.test(seg)) || r === seg; }

    function pathMatches(path, rule) {
        var r = splitRule(rule), i;
        if (r.length !== path.length && !(r[r.length - 1] === "**" && path.length >= r.length)) return false;
        for (i = 0; i < r.length; i++) {
            if (r[i] === "**") return true;
            if (i >= path.length || !segMatches(r[i], path[i])) return false;
        }
        return true;
    }

    function omitted(path, o) {
        var i, j, r, n, ok;
        for (i = 0; i < o.omit.length; i++) if (pathMatches(path, o.omit[i])) return true;
        if (o.pick.length) {
            for (i = 0; i < o.pick.length; i++) {
                r = splitRule(o.pick[i]); n = Math.min(r.length, path.length); ok = true;
                for (j = 0; j < n; j++) if (!segMatches(r[j], path[j])) { ok = false; break; }
                if (ok) return false;       // on the path of a picked rule (prefix) or matching it
            }
            return true;
        }
        return false;
    }

    /** Deep copy of a value without the given paths ("a.b", "list[].x", "*.secret", "audit.**"). */
    function omit(obj, paths) { return toJS(obj, { omit: paths }); }
    /** Deep copy of a value keeping only the given paths. */
    function pick(obj, paths) { return toJS(obj, { pick: paths }); }

    // ------------------------------------------------------------------ engine access
    function serializer() {
        // "tw" is resolved through the scope chain at call time: a server file is loaded in its own scope, not in the script's global object
        try { return typeof tw !== "undefined" && tw !== null && tw.system && tw.system.serializer ? tw.system.serializer : null; } catch (e) { return null; }
    }

    function toEngineXml(v) { var s = serializer(); return s ? String(s.toXml(v)) : ""; }

    /** Type name of a BAW value: "Order", "Order[]", "String[]", "Date", "Time", "Map", "Record", "String" ... ("" when unknown). */
    function typeName(v) {
        var k = typeOf(v), x, m;
        if (k === "twDate") return "Date";
        if (k === "map") return "Map";
        if (k === "string") return "String";
        if (k === "number") return "Decimal";
        if (k === "boolean") return "Boolean";
        if (k === "xml") return tag(v) === "TWDDocument" ? "XMLDocument" : "XMLElement";
        if (k !== "twObject" && k !== "twList") return "";
        try { x = toEngineXml(v); } catch (e) { return ""; }
        m = /^\s*<variable[^>]*\stype="([^"]*)"/.exec(x);
        return m ? m[1] : "";
    }

    // ------------------------------------------------------------------ BAW -> JS
    function xmlText(x) {
        try { return typeof x.toXMLString === "function" ? String(x.toXMLString()) : String(x); } catch (e) { return String(x); }
    }
    function xmlToJS(x, o) {
        if (o.xml === "e4x") return x;
        var text = xmlText(x);
        if (o.xml !== "object") return text;
        try { return xmlObject(typeof x === "xml" ? x : new XML(text.replace(/^\s*<\?xml[^>]*\?>\s*/, ""))); } catch (e) { return text; }
    }
    function xmlObject(x) {
        // E4X element -> {name, attributes: {}, text: "..." | children: [...]}
        var r = { name: String(x.name()) }, attrs = x.attributes(), i, kids = x.children(), children = [];
        if (attrs.length() > 0) { r.attributes = {}; for (i = 0; i < attrs.length(); i++) r.attributes[String(attrs[i].name())] = String(attrs[i]); }
        for (i = 0; i < kids.length(); i++) {
            if (kids[i].nodeKind() === "text") { var tx = String(kids[i]); if (tx.replace(/\s+/g, "") !== "") children.push(tx); }
            else if (kids[i].nodeKind() === "element") children.push(xmlObject(kids[i]));
        }
        if (children.length === 1 && typeof children[0] === "string") r.text = children[0]; else if (children.length) r.children = children;
        return r;
    }

    function javaToJS(v, o, path, depth, stack) {
        if (o.java === "skip") return undefined;
        if (typeof o.java === "function") return o.java(v);
        try {
            var cls = String(v.getClass().getName());
            if (cls === "java.math.BigDecimal" || cls === "java.math.BigInteger") return o.decimalAs === "string" ? String(v.toString()) : Number(v.doubleValue());
            if (/^java\.lang\.(Integer|Long|Short|Byte|Double|Float)$/.test(cls)) return Number(v.doubleValue());
            if (cls === "java.lang.Boolean") return Boolean(v.booleanValue());
            if (cls === "java.lang.String" || cls === "java.lang.Character") return String(v);
            if (typeof v.getTime === "function" && typeof v.getTimeInMillis !== "function") return formatDate(new Date(Number(v.getTime())), o.dateFormat);   // java.util.Date, java.sql.*
            if (typeof v.getTimeInMillis === "function") return formatDate(new Date(Number(v.getTimeInMillis())), o.dateFormat);                          // java.util.Calendar
            if (typeof v.entrySet === "function") {                                                                                                    // java.util.Map
                var out = {}, it = v.entrySet().iterator();
                while (it.hasNext()) { var e = it.next(); out[String(e.getKey())] = convert(e.getValue(), o, path.concat([String(e.getKey())]), depth + 1, stack); }
                return out;
            }
            if (typeof v.iterator === "function") {                                                                                                    // java.util.Collection
                var arr = [], it2 = v.iterator(), n = 0;
                while (it2.hasNext()) arr.push(convert(it2.next(), o, path.concat([String(n++)]), depth + 1, stack));
                return arr;
            }
            if (tag(v) === "JavaArray") { var a2 = [], i; for (i = 0; i < v.length; i++) a2.push(convert(v[i], o, path.concat([String(i)]), depth + 1, stack)); return a2; }
        } catch (ignore) { /* fall through */ }
        return String(v);
    }

    /** The names of the properties a business object currently holds (the engine lists the properties that were set, not the declared ones). */
    function propertyNamesOf(tw) {
        var names = null;
        try { names = tw.propertyNames; } catch (e) { names = null; }
        if (names && typeof names.length === "number") return names;
        return [];
    }

    /** Keys of a BAW Map (the engine exposes no key enumeration: they are read from the Map's own XML). */
    function mapKeys(m) {
        var keys = [], x, re = /<key\b[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/key>/g, r;
        try { x = typeof m.toXML === "function" ? String(m.toXML()) : toEngineXml(m); } catch (e) { return keys; }
        while ((r = re.exec(x)) !== null) keys.push(r[1] !== undefined ? r[1] : unescapeXml(r[2] || ""));
        return keys;
    }

    function ownKeys(obj) { var r = [], k; for (k in obj) if (hasOwn.call(obj, k)) r.push(k); return r; }

    function convert(v, o, path, depth, stack) {
        var kind = typeOf(v), out, i, n;
        if (kind === "undefined") return undefined;
        if (kind === "null") return null;
        if (depth > o.maxDepth) fail("toJS: maximum depth " + o.maxDepth + " exceeded at " + path.join("."));
        if (kind === "string") out = String(v);
        else if (kind === "number") out = Number(v);
        else if (kind === "boolean") out = Boolean(v);
        else if (kind === "function") return undefined;
        else if (kind === "twDate" || kind === "date") out = formatDate(v, o.dateFormat);
        else if (kind === "xml") out = xmlToJS(v, o);
        else if (kind === "java") out = javaToJS(v, o, path, depth, stack);
        else {
            for (i = 0; i < stack.length; i++) if (stack[i].v === v) {
                if (o.cycles === "error") fail("toJS: cyclic reference at " + path.join(".") + " (already at " + stack[i].p + ")");
                return o.cycles === "ref" ? { "$ref": stack[i].p } : null;
            }
            stack.push({ v: v, p: path.join(".") || "$" });
            try {
                if (kind === "twList" || kind === "array") {
                    out = [];
                    n = kind === "twList" ? v.listLength : v.length;
                    for (i = 0; i < n; i++) { var item = convert(v[i], o, path.concat([String(i)]), depth + 1, stack); out.push(item === undefined ? null : item); }
                } else {
                    out = {};
                    var names, getter;
                    if (kind === "map") { names = mapKeys(v); getter = function (k) { return v.get(k); }; }
                    else if (kind === "twObject") { names = propertyNamesOf(v); getter = function (k) { return v[k]; }; }
                    else { names = ownKeys(v); getter = function (k) { return v[k]; }; }
                    if (o.typeProperty && (kind === "twObject" || kind === "map")) { var tn = typeName(v); if (tn) out[o.typeProperty] = tn; }
                    for (i = 0; i < names.length; i++) {
                        var name = String(names[i]), key = name, p2 = path.concat([name]), raw;
                        if (omitted(p2, o)) continue;
                        if (o.keyMapper) { key = o.keyMapper(name, p2); if (key === null || key === undefined || key === "") continue; }
                        try { raw = getter(name); } catch (e) { raw = undefined; }
                        if (typeof raw === "function") continue;
                        if (raw === null || raw === undefined) { if (o.emptyProperties) out[key] = null; continue; }
                        var val = convert(raw, o, p2, depth + 1, stack);
                        if (val === undefined) continue;
                        if (isArray(val) && val.length === 0 && !o.emptyLists) continue;
                        out[key] = val;
                    }
                }
            } finally { stack.pop(); }
        }
        if (o.valueMapper) { var mapped = o.valueMapper(out, path, v); if (mapped !== undefined) out = mapped; }
        return out;
    }

    /** BAW value (business object, list, TWDate, Map, Record, XML, Java, plain JS) -> plain JavaScript value ready for JSON.stringify. */
    function toJS(value, options) {
        var o = settings(options);
        return convert(value, o, [], 0, []);
    }

    /** BAW value -> JSON text. */
    function toJSON(value, options) {
        var o = settings(options), js = toJS(value, o);
        if (js === undefined) return "null";
        return o.indent ? JSON.stringify(js, null, o.indent) : JSON.stringify(js);
    }

    // ------------------------------------------------------------------ JSON -> JS
    /** JSON text -> plain JavaScript value. With reviveDates, strings that look like ISO 8601 dates become Date objects. */
    function parse(text, options) {
        var o = settings(options);
        if (text === null || text === undefined) return null;
        if (typeof text !== "string") return text;
        if (text.replace(/^\s+|\s+$/g, "") === "") return null;
        var reviver = o.reviveDates ? function (key, value) { return looksLikeDate(value) ? (parseDate(value) || value) : value; } : undefined;
        return JSON.parse(text, reviver);
    }

    // ------------------------------------------------------------------ declared types of business object properties (discovered from the engine, cached)
    var NAME_RE = /^[A-Za-z_][A-Za-z0-9_\-.]*$/;
    var schema = {};            // type name -> { property: descriptor }
    var BASIC_TYPES = { String: 1, Integer: 1, Decimal: 1, Boolean: 1, Date: 1, Time: 1, ANY: 1 };

    function checkName(n, what) { if (!NAME_RE.test(String(n))) fail("invalid " + what + " '" + n + "'"); return String(n); }
    function describe(spec) {                       // "OrderItem[]" -> {type:"OrderItem", list:true}
        var s = String(spec), list = /\[\]$/.test(s);
        return { type: s.replace(/\[\]$/, ""), list: list };
    }
    function describeValue(v) {                     // descriptor of an existing BAW value
        if (isTWList(v)) { var tn = typeName(v); return describe(tn || "ANY[]"); }
        if (isTWObject(v)) return { type: typeName(v) || "Record", list: false };
        if (isTWDate(v)) return { type: "Date", list: false };
        if (isTWMap(v)) return { type: "Map", list: false };
        if (isXML(v)) return { type: typeName(v), list: false };
        if (typeof v === "string") return { type: "String", list: false };
        if (typeof v === "boolean") return { type: "Boolean", list: false };
        if (typeof v === "number") return { type: "Decimal", list: false };
        return null;
    }
    function errorText(e) { return String(e && e.message ? e.message : e); }

    /**
     * Declared type of a property of a business object type, discovered through the engine's XML deserializer and cached
     * (one to two engine calls per type + property, then free). Returns "Date", "String", "Integer", "Decimal", "Boolean", "ANY", "Map", "Record",
     * "XMLElement", "OrderItem", "OrderItem[]", "String[]" ... or null when the type does not declare the property.
     */
    function propertyType(type, prop, o) {
        var t = String(type).replace(/^toolkit:/, ""), cache = schema[t] || (schema[t] = {}), declared, r, v, d;
        declared = o && o.types && (o.types[t] || o.types[t.split(".").pop()]);
        if (declared && declared[prop]) return String(declared[prop]);
        if (hasOwn.call(cache, prop)) return cache[prop];
        var s = serializer();
        if (!s) return (cache[prop] = "ANY");
        checkName(prop, "property name"); checkName(t.split(".").pop(), "type name");
        function probe(inner) { return s.fromXml('<variable type="' + t.split(".").pop() + '">' + inner + '</variable>'); }
        function kind(v) { var d = describeValue(v); return d ? d.type + (d.list ? "[]" : "") : null; }
        try { r = probe("<" + prop + "/>"); } catch (e) {
            var msg = errorText(e);
            if (/does not exist on the specified type|is not declared/.test(msg)) return (cache[prop] = null);
            if (/Cannot find the business object type/.test(msg)) fail("unknown business object type '" + t + "'");
            if (/Unparseable date/.test(msg)) return (cache[prop] = "Date");
            if (/NumberFormatException/.test(msg)) return (cache[prop] = /For input string: ""/.test(msg) ? "Integer" : "Decimal");
            if (/must be array/.test(msg)) {                                    // a list whose element type the empty element cannot show (ANY[])
                try { r = probe("<" + prop + ' type="ANY[]"><item type="String">a</item></' + prop + ">"); return (cache[prop] = kind(r[prop]) || "ANY[]"); } catch (e2) { return (cache[prop] = "ANY[]"); }
            }
            if (/Premature end of file/.test(msg)) {                            // XML element / document
                try { r = probe("<" + prop + "><![CDATA[<a/>]]></" + prop + ">"); return (cache[prop] = kind(r[prop]) || "XMLElement"); } catch (e3) { return (cache[prop] = "XMLElement"); }
            }
            return (cache[prop] = null);
        }
        try { v = r[prop]; } catch (e4) { return (cache[prop] = null); }
        if (typeof v === "string") {
            // an empty element reads as "" for String and for ANY: a typed number tells them apart
            try { r = probe("<" + prop + ' type="Integer">1</' + prop + ">"); return (cache[prop] = typeof r[prop] === "number" ? "ANY" : "String"); }
            catch (e5) { return (cache[prop] = "String"); }
        }
        if (typeof v === "boolean") return (cache[prop] = "Boolean");
        d = kind(v);
        return (cache[prop] = d || "ANY");
    }

    // ------------------------------------------------------------------ JS -> BAW (through the engine's own XML deserializer, which applies the declared schema)
    function cdata(s) { return "<![CDATA[" + String(s).replace(/\]\]>/g, "]]]]><![CDATA[>") + "]]>"; }
    function unescapeXml(s) { return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
    function isInt32(n) { return n === Math.floor(n) && n >= -2147483648 && n <= 2147483647; }

    /** XML element (name, attributes) for a JavaScript value; "" when the value is null / undefined / unsupported. */
    function element(name, v, spec, o, path, depth) {
        var type = spec ? spec.type : null, list = spec ? spec.list : false, i, body, tn, d;
        if (v === null || v === undefined) return "";
        if (depth > o.maxDepth) fail("fromJS: maximum depth " + o.maxDepth + " exceeded at " + path.join("."));
        // values that already are BAW values: embed the engine's own XML of them (exact type and content)
        if (isTWObject(v) || isTWMap(v) || isTWDate(v)) {
            var x = toEngineXml(v).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
            return x.replace(/^\s*<variable\b/, "<" + name).replace(/<\/variable>\s*$/, "</" + name + ">").replace(/^<([^\s>]+)([^>]*)\/>\s*$/, "<$1$2/>");
        }
        if (isXML(v) || (type && /^XML/.test(type) && typeof v === "string")) {
            // XML text: whitespace between elements is dropped, otherwise every round trip through the engine's pretty printer adds more of it
            return "<" + name + ' type="' + (type && /^XML/.test(type) ? type : "XMLElement") + '">' + cdata((isXML(v) ? xmlText(v) : v).replace(/^\s*<\?xml[^>]*\?>\s*/, "").replace(/>\s+</g, "><").replace(/^\s+|\s+$/g, "")) + "</" + name + ">";
        }
        if (isJava(v)) v = javaToJS(v, o, path, depth, []);
        // a declared list (or an array value): every element is an <item>
        if (list || (isArray(v) && (!type || type === "ANY"))) {
            var arr = isArray(v) ? v : [v], items = [], elemSpec = list ? { type: type, list: false } : null;
            for (i = 0; i < arr.length; i++) { var it = element("item", arr[i], elemSpec, o, path.concat([String(i)]), depth + 1); items.push(it === "" ? "<item/>" : it); }
            return "<" + name + ' type="' + (list ? type + "[]" : "ANY[]") + '">' + items.join("") + "</" + name + ">";
        }
        if (type === "String" && (isArray(v) || isPlainObject(v))) {
            // a String property receiving structured data keeps it as JSON text (strict: error)
            if (o.strict) fail("fromJS: " + path.join(".") + " is " + (isArray(v) ? "an array" : "an object") + " but the property is declared as String");
            return "<" + name + ' type="String">' + cdata(JSON.stringify(v)) + "</" + name + ">";
        }
        if (isArray(v)) fail("fromJS: " + path.join(".") + " is an array but the property is declared as " + type);
        if (type === "String" && isNativeDate(v)) return "<" + name + ' type="String">' + cdata(formatDate(v, o.dateFormat)) + "</" + name + ">";
        // dates: the engine accepts its own text format only
        if (type === "Date" || type === "Time" || isNativeDate(v)) {
            d = nativeDate(v);
            if (!d || isNaN(d.getTime())) fail("fromJS: " + path.join(".") + " = " + JSON.stringify(String(v)) + " is not a date");
            return "<" + name + ' type="' + (type === "Time" ? "Time" : "Date") + '">' + formatDate(d, "engine") + "</" + name + ">";
        }
        if (type === "Map" || (isPlainObject(v) && o.typeProperty && v[o.typeProperty] === "Map")) return mapElement(name, v, o, path, depth);
        if (isPlainObject(v)) {
            tn = o.typeProperty && v[o.typeProperty] ? String(v[o.typeProperty]) : (type && !BASIC_TYPES[type] && type !== "Record" ? type : "Record");
            if (tn === "Map") return mapElement(name, v, o, path, depth);
            checkName(tn.split(".").pop(), "type name");
            body = objectBody(v, tn, o, path, depth);
            return "<" + name + ' type="' + tn.split(".").pop() + '">' + body + "</" + name + ">";
        }
        // primitives: typed by their JavaScript type (the engine ignores the attribute for declared properties and uses it for ANY / Record)
        if (typeof v === "boolean") return "<" + name + ' type="Boolean">' + v + "</" + name + ">";
        if (typeof v === "number") {
            if (isNaN(v) || !isFinite(v)) fail("fromJS: " + path.join(".") + " is " + v);
            return "<" + name + ' type="' + (isInt32(v) ? "Integer" : "Decimal") + '">' + String(v) + "</" + name + ">";
        }
        if (typeof v === "string") return "<" + name + ' type="String">' + cdata(v) + "</" + name + ">";
        return "";
    }

    function mapElement(name, v, o, path, depth) {
        var entries = [], k;
        for (k in v) {
            if (!hasOwn.call(v, k) || (o.typeProperty && k === o.typeProperty)) continue;
            var val = element("value", v[k], null, o, path.concat([k]), depth + 1);
            entries.push("<entry><key type=\"String\">" + cdata(k) + "</key>" + (val === "" ? "<value/>" : val) + "</entry>");
        }
        return "<" + name + ' type="Map">' + entries.join("") + "</" + name + ">";
    }

    function objectBody(v, typeName_, o, path, depth) {
        var parts = [], k, name, spec, declared;
        for (k in v) {
            if (!hasOwn.call(v, k) || (o.typeProperty && k === o.typeProperty)) continue;
            name = k;
            if (o.keyMapper) { name = o.keyMapper(k, path.concat([k])); if (name === null || name === undefined || name === "") continue; }
            if (typeName_ === "Record" || typeName_ === "ANY") { checkName(name, "property name"); parts.push(element(name, v[k], null, o, path.concat([k]), depth + 1)); continue; }
            if (!NAME_RE.test(name)) { if (o.strict) fail("fromJS: invalid property name '" + name + "' at " + path.join(".")); continue; }
            declared = propertyType(typeName_, name, o);
            if (declared === null) { if (o.strict) fail("fromJS: business object " + typeName_ + " does not declare the property '" + name + "' (" + path.concat([k]).join(".") + ")"); continue; }
            spec = describe(declared);
            if (spec.type === "ANY" && !spec.list) spec = null;
            parts.push(element(name, v[k], spec, o, path.concat([k]), depth + 1));
        }
        return parts.join("");
    }

    /** Plain JavaScript value (or JSON text) -> typed BAW value. type: "Order", "Order[]", "String[]", "Date", "Map", "Record", "ANY" (default). */
    function fromJS(value, type, options) {
        var o = settings(options), spec, root, s = serializer(), x, result;
        if (typeof value === "string" && type && !/^(String|ANY|XMLElement|XMLDocument)$/.test(describe(type).type)) { var t = value.replace(/^\s+|\s+$/g, ""); if (/^[\[{]/.test(t)) value = parse(value, { reviveDates: false }); }
        if (value === null || value === undefined) return null;
        spec = describe(type || "ANY");
        if (spec.type === "ANY" && !spec.list) {
            if (isArray(value)) spec = { type: "ANY", list: true };
            else if (isPlainObject(value)) spec = { type: (o.typeProperty && value[o.typeProperty]) || o.unknownRoot, list: false };
            else if (isNativeDate(value)) spec = { type: "Date", list: false };
            else if (typeof value === "boolean") return value;
            else if (typeof value === "number") return value;
            else if (typeof value === "string") return value;
            else if (isTWObject(value) || isTWMap(value) || isTWDate(value)) return value;
        }
        if (!spec.list && spec.type === "String") return typeof value === "object" ? JSON.stringify(value) : String(value);
        if (!spec.list && (spec.type === "Integer" || spec.type === "Decimal")) { var n = Number(value); if (isNaN(n)) fail("fromJS: " + JSON.stringify(String(value)) + " is not a number"); return spec.type === "Integer" ? Math.round(n) : n; }
        if (!spec.list && spec.type === "Boolean") return typeof value === "boolean" ? value : /^(true|1|yes|y)$/i.test(String(value));
        if (!s) fail("fromJS: tw.system.serializer is not available in this script context");
        if (!spec.list && spec.type === "Date" && !isTWDate(value)) { var dd = nativeDate(value); if (!dd) fail("fromJS: " + JSON.stringify(String(value)) + " is not a date"); value = dd; }
        root = element("variable", value, spec.list ? spec : (BASIC_TYPES[spec.type] ? { type: spec.type, list: false } : { type: spec.type, list: false }), o, [], 0);
        if (root === "") return null;
        // the root element carries the requested type (the value's own $type / Record must not override it for typed roots)
        x = root.replace(/^<variable(\s+type="[^"]*")?/, '<variable type="' + spec.type.split(".").pop() + (spec.list ? "[]" : "") + '"');
        try { result = s.fromXml(x); }
        catch (e) { fail("fromJS into " + type + " failed: " + errorText(e).replace(/\s*Script \(line[\s\S]*$/, "").replace(/^.*fromXML\(\)\s*/, "")); }
        return result;
    }

    /** JSON text -> typed BAW value. */
    function fromJSON(text, type, options) { var o = settings(options); o.reviveDates = false; return fromJS(parse(text, o), type, options); }

    /** Fills an existing business object or list (for instance tw.local.order) from a plain object / array / JSON text; returns the target. */
    function assign(target, value, options) {
        var o = settings(options), tn, converted, names, i;
        if (typeof value === "string") value = parse(value, o);
        if (!isTWObject(target)) fail("assign: the target must be a BAW business object or list");
        tn = (options && options.type) || typeName(target);
        if (!tn) fail("assign: the type of the target could not be determined; pass options.type");
        converted = fromJS(value, tn, o);
        if (isTWList(target)) {
            while (target.listLength > 0) target.removeIndex(target.listLength - 1);
            if (converted) for (i = 0; i < converted.listLength; i++) target.insertIntoList(target.listLength, converted[i]);
            return target;
        }
        if (!converted) return target;
        names = propertyNamesOf(converted);
        for (i = 0; i < names.length; i++) target[names[i]] = converted[names[i]];
        return target;
    }

    /** Deep copy of a BAW value (same type). */
    function copy(value, options) {
        var tn = typeName(value);
        if (!tn) return toJS(value, options);
        return fromJS(toJS(value, settings(options)), tn, options);
    }

    // ------------------------------------------------------------------ namespace
    return {
        VERSION: VERSION, defaults: defaults, schema: schema,
        toJS: toJS, toJSON: toJSON, parse: parse, fromJS: fromJS, fromJSON: fromJSON, assign: assign, copy: copy,
        typeOf: typeOf, typeName: typeName, propertyType: propertyType,
        omit: omit, pick: pick, formatDate: formatDate, parseDate: parseDate, nativeDate: nativeDate,
        isTWObject: isTWObject, isTWList: isTWList, isTWDate: isTWDate, isTWMap: isTWMap
    };
}(typeof this !== "undefined" ? this : {}));

/*  BPMJSON - compatibility with the widely used "BPM JSON Utils" API (convertTwToJS / convertTwToJSON / convertJSONToTw ...), same function
 *  names and result shapes as version 2.9 of that library: empty properties are left out, dates are formatted as "yyyy-MM-dd HH:mm:ssZ",
 *  convertJSONToTw turns "" into null and revives date strings. New code should use BAWJSON directly. Only defined when no BPMJSON exists. */
if (typeof BPMJSON === "undefined" || BPMJSON === null || !BPMJSON.convertTwToJS) {
    var BPMJSON = (function () {
        var legacy = { emptyProperties: false, emptyLists: false, dateFormat: "legacy" };
        function withRemoved(obj, list) {
            if (!obj || !list || !list.length) return obj;
            var names = typeof list === "string" ? list.split(",") : list, i;
            for (i = 0; i < names.length; i++) delete obj[String(names[i]).replace(/^\s+|\s+$/g, "")];
            return obj;
        }
        return {
            formatUTCDate: function (date) { return date && Object.prototype.toString.call(date) === "[object Date]" ? BAWJSON.formatDate(date, "legacy") : null; },
            parseTWDate: function (strDate) { var d = BAWJSON.parseDate(strDate); return d ? BAWJSON.fromJS(d, "Date") : new tw.object.Date(); },
            formatTWDate: function (twDate) { try { return twDate ? BAWJSON.formatDate(twDate, "isoSeconds") : null; } catch (e) { return null; } },
            convertTwToJS: function (twObject) { return twObject ? BAWJSON.toJS(twObject, legacy) : null; },
            convertTwToJSON: function (twObject, removeAttributesList) { return twObject ? JSON.stringify(withRemoved(BAWJSON.toJS(twObject, legacy), removeAttributesList)) : null; },
            convertJSToJSON: function (jsObj) { return jsObj === undefined || jsObj === null ? "" : JSON.stringify(jsObj); },
            removeJSObjectAttributes: function (obj, listOfAttributes) { withRemoved(obj, listOfAttributes); },
            convertJSONToTw: function (jsonText) {
                if (jsonText === null || jsonText === undefined) return null;
                return JSON.parse(jsonText, function (key, value) {
                    if (value === "" || value === null) return null;
                    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) { var d = BAWJSON.parseDate(value); if (d) return d; }
                    return value;
                });
            },
            /* new: typed conversions */
            convertJSONToTwObject: function (jsonText, typeName, options) { return BAWJSON.fromJSON(jsonText, typeName, options); },
            convertJSToTw: function (jsObj, typeName, options) { return BAWJSON.fromJS(jsObj, typeName, options); }
        };
    }());
}
