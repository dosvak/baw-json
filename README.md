# baw-json - business objects <-> JSON for IBM BPM / Business Automation Workflow

Repository: https://github.com/dosvak/baw-json (Apache-2.0, attribution required). Part of the open-source BAW tooling of [Dosvak](https://github.com/dosvak).

`baw-json.js` converts IBM Business Automation Workflow (BAW, IBM BPM 8.5.x / 8.6, BAW on containers, Cloud Pak for Business
Automation Workflow) business objects to JSON and JSON back to typed business objects, in server-side JavaScript, for every
type the engine has: complex business objects (nested, recursive), lists, String, Integer, Decimal, Boolean, Date, Time, ANY,
NameValuePair, Map, Record, XMLElement / XMLDocument and Java values held in ANY properties.

It is published under the **Apache License 2.0** ([LICENSE](LICENSE), [NOTICE](NOTICE)): use it, change it, ship it, including in
commercial products, keeping the copyright notice, the license and the NOTICE file with your copies (attribution to Dosvak LLC).
Version 1.0.0 (the file inside the 1.0 toolkit package) was released into the public domain (The Unlicense); copies obtained under
that release keep those terms; 1.0.1 is the same code under Apache-2.0. It is a
clean-room implementation that replaces the older "BPM JSON Utils" script (same function names are available through the
`BPMJSON` compatibility layer).

The library has **no egress and no ingress**: it opens no network connection, listens on nothing, reads and writes no files, uses no
reflection and loads no code. It only calls the engine's own `tw.object` constructors and `tw.system.serializer`
([tests/security-check.py](tests/security-check.py) enforces this).

## Why

`JSON.stringify(tw.local.order)` returns `{}` on the server: business objects are host objects whose properties native JSON does not
see, dates are `TWDate` objects, lists are not arrays, and assigning the wrong kind of value to a typed property (a string to a Date,
a double to an Integer, a plain object to ANY) does not throw a catchable JavaScript error - it kills the whole service. Integration
scripts therefore end up with hand-written mapping code for every REST payload. This library replaces that code:

```javascript
// business object -> JSON (REST request body, message payload, log line)
var body = BAWJSON.toJSON(tw.local.order);

// JSON -> business object (REST response, message, external system), typed by the business object's own declaration
tw.local.order = BAWJSON.fromJSON(response.content, "Order");

// fill an existing object in place
BAWJSON.assign(tw.local.order, response.content);
```

## Installation

Either import the ready-made toolkit **`packages/BAW-JSON-Toolkit-1.0.twx`** (toolkit "BAW JSON", acronym BAWJSN: it contains only the
server file) into Process Center / Workflow Center and add it as a dependency of your process apps and toolkits, or add `baw-json.js`
to a toolkit of your own as a **Server File** (Process Designer: Files > New > Server File; Workflow Center: Files > Server).
Every server script of the process apps and toolkits that depend on that toolkit then sees the `BAWJSON` namespace (and `BPMJSON`).

Nothing else is needed: no configuration, no environment variables, no external service. The library works on IBM BPM 8.5.x, 8.6,
BAW 18 to 25 and on Cloud Pak for Business Automation (Rhino 1.7 on Java 8 or later; native `JSON` is used).

`json2.js` (Douglas Crockford's public-domain JSON reference implementation, 2023-05-10) is included for engines that lack native
JSON (BPM 7.5 / 8.0 era); modern engines do not need it.

## API

### BAW -> JSON

| Function | Result |
|---|---|
| `BAWJSON.toJS(value [, options])` | plain JavaScript value (objects, arrays, strings, numbers, booleans, null) for any BAW value |
| `BAWJSON.toJSON(value [, options])` | the same as a JSON string; `options.indent` pretty prints |

Conversion rules (defaults, all changeable through options):

| BAW value | JSON |
|---|---|
| business object | object with the properties that are set (the engine only lists set properties; never-set ones are absent) |
| list (`listOf.X`) | array |
| String / Integer / Decimal / Boolean | string / number / boolean |
| Date, Time (both `TWDate`) | `"2025-01-15T10:30:00.123Z"` (ISO 8601 UTC); `dateFormat` gives `isoSeconds`, `date`, `epoch`, `legacy` or a function |
| null property | `null` (`emptyProperties: false` leaves it out) |
| empty list | `[]` (`emptyLists: false` leaves it out) |
| ANY | whatever it holds, converted by the same rules |
| Map | object of the entries (keys are read from the Map's own XML because the engine offers no key enumeration) |
| Record | object of the columns |
| NameValuePair | `{"name": ..., "value": ...}` |
| XMLElement / XMLDocument | XML text (`xml: "object"` gives `{name, attributes, text | children}`, `"e4x"` leaves the object) |
| java.util.Date / Calendar, BigDecimal, Integer, Long, Boolean, String, List, Map, arrays | date text, number (`decimalAs: "string"` keeps big decimals exact), boolean, string, array, object |
| cyclic reference | `null` (`cycles: "ref"` gives `{"$ref": "path"}`, `"error"` throws) |

### JSON -> BAW

| Function | Result |
|---|---|
| `BAWJSON.parse(text [, options])` | plain JavaScript value; ISO 8601 strings become `Date` objects (`reviveDates: false` keeps them) |
| `BAWJSON.fromJS(value, type [, options])` | typed BAW value from a plain value (or JSON text); `type` = `"Order"`, `"Order[]"`, `"String[]"`, `"Date"`, `"Map"`, `"Record"`, `"ANY"` |
| `BAWJSON.fromJSON(text, type [, options])` | typed BAW value from JSON text |
| `BAWJSON.assign(target, value [, options])` | fills an existing business object or list in place (properties present in the value are replaced, the others stay) |

How it works: the value is rendered into the engine's own XML variable format and handed to `tw.system.serializer.fromXml`, which
builds the business object **according to its declared schema** (nested types, list element types, dates, numbers). The declared
type of every property is discovered from the engine once per type and property (`BAWJSON.propertyType`, cached), so the
converter knows which JSON strings are dates, which numbers must be integers and which properties do not exist. Consequences:

* properties the business object does not declare are **skipped** (`strict: true` makes them throw) - REST responses with extra
  fields map onto small business objects without any code;
* dates in JSON (`"2025-01-15T10:30:00Z"`, `"2025-01-15"`, epoch milliseconds, the engine's `2025/01/15 10:30:00.123 UTC`) go into
  Date and Time properties exactly, while the same text going into a String property stays the original text;
* numbers as strings (`"42"`) go into Integer / Decimal properties; `"abc"` or an out-of-range integer raises a normal JavaScript
  `Error` with the value in the message (instead of the engine's fatal type mismatch);
* nested objects, lists of objects, lists of scalars, recursive types (a type that contains itself) work to any depth (`maxDepth`);
* ANY properties receive typed values: numbers, booleans, strings, dates, arrays (`ANY[]`), and plain objects as `Record`; with
  `typeProperty: "$type"` a plain object carrying `"$type": "OrderItem"` becomes that business object, `"$type": "Map"` a Map;
* Map properties take plain objects (each key an entry); Record properties take any plain object;
* XMLElement / XMLDocument properties take XML text;
* a single value for a list property becomes a one-element list.

### Helpers

| Function | Purpose |
|---|---|
| `BAWJSON.typeOf(value)` | `"twObject"`, `"twList"`, `"twDate"`, `"map"`, `"xml"`, `"date"`, `"array"`, `"object"`, `"java"`, `"string"`, `"number"`, `"boolean"`, `"null"`, `"undefined"` |
| `BAWJSON.typeName(value)` | declared type of a BAW value: `"Order"`, `"Order[]"`, `"String[]"`, `"Date"`, `"Map"`, `"Record"`, `"XMLElement"` |
| `BAWJSON.propertyType(type, property)` | declared type of a property (`"Date"`, `"OrderItem[]"`, `"Integer"`, `"ANY"`, ...; `null` = not declared) |
| `BAWJSON.copy(value)` | deep copy of a BAW value of the same type |
| `BAWJSON.omit(value, paths)` / `BAWJSON.pick(value, paths)` | deep copy without / with only the given paths: `"a.b"`, `"items[].price"`, `"*.secret"`, `"audit.**"` |
| `BAWJSON.formatDate(date, format)` / `BAWJSON.parseDate(text)` | ISO 8601 (UTC) formatting and parsing (also the engine's own date text) |
| `BAWJSON.schema` | the discovered property types (inspect or pre-fill) |

### Options

```javascript
BAWJSON.toJSON(tw.local.order, {
    emptyProperties: false,          // leave out null properties
    dateFormat: "isoSeconds",        // "iso" (default, with milliseconds) | "isoSeconds" | "date" | "epoch" | "legacy" | function (d) {...}
    omit: ["customer.creditCard", "items[].internalNotes", "audit.**"],
    keyMapper: function (name, path) { return name === "piid" ? "id" : name; },
    valueMapper: function (value, path, original) { return path.join(".") === "total" ? Math.round(value * 100) / 100 : undefined; },
    typeProperty: "$type",           // add the BAW type name to every object
    indent: 2
});

BAWJSON.fromJSON(text, "Order", {
    strict: true,                    // unknown properties throw instead of being skipped
    types: { Order: { extra: "Date" } },   // declare (or override) property types
    keyMapper: function (name) { return name.replace(/-/g, "_"); },   // rename incoming keys (e.g. "refresh-groups")
    typeProperty: "$type"            // honour "$type" in plain objects for ANY / Record properties
});
```

All options: `emptyProperties`, `emptyLists`, `dateFormat`, `decimalAs`, `xml`, `java`, `maxDepth`, `cycles`, `keyMapper`,
`valueMapper`, `typeProperty`, `omit`, `pick`, `reviveDates`, `types`, `strict`, `unknownRoot`, `indent`. Defaults are in
`BAWJSON.defaults` (change them once at the top of a script if a whole app prefers, for instance, `dateFormat: "isoSeconds"`).

### Compatibility layer: BPMJSON

Scripts written for the widely used "BPM JSON Utils" keep working without changes; the same names return the same shapes
(empty properties left out, dates as `yyyy-MM-dd HH:mm:ssZ`, `""` turned into `null` on the way in):

`BPMJSON.convertTwToJS(twObject)`, `BPMJSON.convertTwToJSON(twObject, removeAttributesList)`, `BPMJSON.convertJSToJSON(jsObj)`,
`BPMJSON.removeJSObjectAttributes(obj, list)`, `BPMJSON.convertJSONToTw(jsonText)`, `BPMJSON.formatUTCDate(date)`,
`BPMJSON.parseTWDate(text)`, `BPMJSON.formatTWDate(twDate)`, plus the new typed `BPMJSON.convertJSONToTwObject(text, typeName)`
and `BPMJSON.convertJSToTw(jsObj, typeName)`. `BPMJSON` is only defined when no other `BPMJSON` exists in the scope.

## Examples

```javascript
// 1. REST response -> business object (unknown fields skipped, dates typed, numbers checked)
var resp = tw.system.invokeREST(request);
tw.local.process = BAWJSON.fromJSON(resp.content, "ProcessInfo");

// 2. business object -> REST request body
request.content = BAWJSON.toJSON(tw.local.order, { emptyProperties: false, dateFormat: "isoSeconds" });

// 3. list of business objects <-> array
tw.local.items = BAWJSON.fromJS(rows, "OrderItem[]");
var rows = BAWJSON.toJS(tw.local.items);

// 4. generic payloads: no business object needed
var record = BAWJSON.fromJS({ id: 7, tags: ["a", "b"], nested: { x: 1 } });      // Record with typed columns
tw.local.anything = BAWJSON.fromJS(JSON.parse(text));                            // into an ANY variable

// 5. copy / patch
tw.local.draft = BAWJSON.copy(tw.local.order);
BAWJSON.assign(tw.local.order, { status: "APPROVED", approvedOn: new Date() });

// 6. mask before logging
log.info(BAWJSON.toJSON(tw.local.customer, { omit: ["iban", "cards[].number"] }));
```

## Engine facts the library is built on (verified on BPM 8.6.2)

* `tw.local.x.propertyNames` lists the properties that were **set**, not the declared ones; the declared schema is not available
  to scripts. `tw.system.serializer.toXml(value)` names the type of any value (`<variable type="Order[]">`).
* Assigning a wrong kind of value to a typed property is fatal for the script (not catchable): string or number into Date, double or
  out-of-range value into Integer (32-bit), number into String, plain object into ANY / Map / Record, single value into a list,
  plain object with an undeclared key into a business object. The library never assigns raw values; everything goes through
  `fromXml`, whose errors are ordinary catchable exceptions.
* `tw.system.serializer.fromXml(text)` accepts the engine's variable XML with or without `type` attributes: a `type` attribute on a
  declared property is ignored (the declared type wins), on an ANY or Record child it decides the value type. Dates in that XML must
  use `yyyy/MM/dd HH:mm:ss.SSS UTC`.
* `TWDate.getTime()` does not return milliseconds; use `toNativeDate()`. Time properties are `TWDate` values as well.
* `tw.object.<UnknownType>` and `for (k in tw.object)` are fatal; the library never enumerates host objects and only names types it
  was given (validated against `[A-Za-z_][A-Za-z0-9_.-]*`).
* Map has `put / get / containsKey / remove / size / toXML` but no key enumeration; Record accepts any column names.

## Tests

* [tests/engine-tests.js](tests/engine-tests.js): 170+ checks on the engine for every type, option, error and the BPMJSON layer.
* [tests/rest-tests.js](tests/rest-tests.js): real Process REST API responses ([tests/data](tests/data), captured from a BPM 8.6.2
  Process Center with host names and addresses replaced: process instance, task, searches, user, systems, process apps, exposed items) and Process REST v2 payloads shaped by the
  v2 Swagger, converted JSON -> business object -> JSON and compared field by field.
* [tests/security-check.py](tests/security-check.py): the no-network / no-file / no-reflection guarantee.
* `tools/bawjson_test.py` (in the author's workspace repository, not in this package): runs everything against a Process Center, including end-to-end
  REST calls driven by converter output (start a process, set instance variables, set task data, CSRF login), and writes
  [tests/REPORT.md](tests/REPORT.md). The test process app is generated by the workspace tool `build_bawjson.py`
  (business objects of every type plus objects generated from the captured payloads and the Swagger, the library as server file,
  and a "Run Script" service that evaluates test scripts - **that app is for test servers only**).

## Limitations

* Properties that were never set are absent from the JSON (the engine does not expose declared-but-unset properties).
* Integer properties are 32-bit in the engine; larger integers must be Decimal (or String) properties.
* Time and Date are the same runtime type; `toJS` formats both with `dateFormat`.
* `fromJS` into a Map, Record or ANY cannot know that a plain object should become a specific business object unless the object
  carries `$type` (`typeProperty`) or the target property is declared.
* Whitespace between XML elements is dropped when XML text goes into XMLElement / XMLDocument properties (the engine pretty prints).
* Very large values: every `fromJS` is one engine deserialisation and every `toJS` walks the object; 500 objects with 6 properties
  each take about 0.5 s in and 0.1 s out on a small test server.

## Files

| File | Content |
|---|---|
| `baw-json.js` | the library |
| `packages/BAW-JSON-Toolkit-1.0.twx` | the library packaged as the toolkit **BAW JSON** (`BAWJSN`) for traditional BAW / IBM BPM (import into Process Center / Workflow Center) |
| `packages/BAW-JSON-Test-1.0.twx` | the process app **BAW JSON Test** (`BAWJSON`) that validated the library on a Process Center: business objects of every type, business objects generated from real Process REST v1 responses and the v2 Swagger, and an Ajax-exposed "Run Script" service that evaluates JavaScript sent by the test harness - **test servers only, never install it in production** |
| `packages/cp4ba/*-CP4BA_25.twx` | toolkit and test app as exported from CP4BA 25.0.1 Workflow Authoring after validation (Run Script service verified there) |
| `json2.js` | Crockford's JSON polyfill (public domain), only for engines without native JSON |
| `LICENSE`, `NOTICE` | Apache License 2.0 and the attribution notice |
| `tests/` | engine tests, REST payload tests, captured payloads, security check, latest report; `docs/TEST-REPORT-2026-09-06.md` = the validation run on a Process Center |

## About

Published by [Dosvak LLC](https://dosvak.com), an IBM Business Partner (Silver, IBM Partner Plus), as part of its open-source tooling
for IBM Business Automation Workflow. More: [github.com/dosvak](https://github.com/dosvak), questions and answers on
[bpm.tips](https://bpm.tips).

IBM, IBM Business Automation Workflow, IBM Business Process Manager and IBM Cloud Pak are trademarks or registered trademarks of
International Business Machines Corporation. This project is not affiliated with, endorsed by or supported by IBM.
