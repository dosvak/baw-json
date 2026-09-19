# BAW JSON converter validation - 2026-09-06

Library: BAW-2-JSON/baw-json.js version 1.0.0; engine: BPM 8.6.2 Process Center <process-center-host>, app "BAW JSON Test" (library loaded from the server file of the app)
## 1. Security check

```
baw-json.js security check: 621 lines, CLEAN - no network, file, database, reflection or dynamic code use
```

## 2. Engine unit tests (tests/engine-tests.js)

ALL PASSED 173 checks  (173 passed)
- info 500 rows: fromJS 571 ms, toJS 74 ms, schema cache {"when":"Date","tags":"String[]","qty":"Integer","price":"Decimal","name":"String","active":"Boolean","unknownField":null}

## 3. REST payload round trips (tests/rest-tests.js)

ALL PASSED 41 checks

| Payload | Business object | Result |
|---|---|---|
| v1-process-all.json | V1Process | OK (174 fields, 24 ms) |
| v1-task-all.json | V1Task | OK (48 fields, 9 ms) |
| v1-search-byInstance.json | V1SearchInstances | OK (99 fields, 18 ms) |
| v1-search-byTask.json | V1SearchTasks | OK (27 fields, 5 ms) |
| v1-user.json | V1User | OK (13 fields, 10 ms) |
| v1-systems.json | V1Systems | OK (18 fields, 3 ms) |
| v1-processApps.json | V1ProcessApps | OK (427 fields, 87 ms) |
| v1-exposed.json | V1Exposed | OK (784 fields, 149 ms) |
| v2-processes.json | V2Processes | OK (33 fields, 7 ms) |
| v2-user-tasks.json | V2UserTasks | OK (41 fields, 8 ms) |
| v2-login.json | V2LoginRequest | OK (2 fields, 0 ms) |
| v2-csrf.json | V2CsrfToken | OK (2 fields, 1 ms) |
| v2-exception.json | V2Exception | OK (7 fields, 2 ms) |

## 4. End-to-end: converter output drives real REST calls

- OK: server built the start parameters with BAWJSON.toJSON ({"label":"baw-json e2e 1788708538191","payload":"{\"name\":\"baw-json e2e 1788708538191\",\"qty\":7,\"tags\":[\"e2e\"]}")
- OK: POST /process?action=start accepted the JSON ({'status': '200', 'data': {'creationTime': '2026-09-06T15:28:58Z', 'description': '', 'richDescription': '', 'executionState': 'Active', 'state': 'STATE_RUNNING)
- OK: GET /process?parts=data -> fromJS(V1Process) -> nested payload -> JsonChild ({"label":"baw-json e2e 1788708538191","qty":7,"tags":["e2e"],"type":"V1Process"})
- OK: PUT instance variables with converter JSON, read back equal (HTTP 200 {'status': '200', 'data': {'message': 'Successfully updated.'}} -> {'payload': 'set through the variables API', 'label': 'changed by BAWJSON 1788708540648'})
- SKIP: the benchmark task declares no variables
- SKIP: /system/login not available (HTTP 404)

## Summary

- security: PASS
- unit: PASS
- payloads: PASS
- e2e: PASS
