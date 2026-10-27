# Private inference boundary — local prototype

This directory provides a **Python standard-library-only, loopback-only
prototype** for a public football UI to call a separately held private backend.
It does not include weights, match data, video, a trained model, or a production
deployment. The default server deliberately cannot perform inference.

Run from the repository root with Python 3.10 or newer:

```sh
python3 -m service.server
```

`GET http://127.0.0.1:8765/health` returns:

```json
{"status":"ok","schema_version":"1.0","backend":"unavailable"}
```

This indicates that the HTTP process is alive. It does not claim backend
readiness. A valid `POST /v1/respond` returns HTTP 503 with the code
`private_backend_unavailable` until a backend is explicitly selected.

## Explicit synthetic demonstration

```sh
python3 -m service.server --demo --allow-origin http://localhost:5174
```

Add a separate `--allow-origin http://127.0.0.1:5174` if the development UI uses
that origin. The allowlist is exact; no origins are granted by default. Only
HTTP(S) origins on `localhost` or numeric loopback addresses are accepted. There
is no wildcard or credentialed CORS. Local command-line clients may omit Origin.

The demo constructs 22 synthetic positions in a simple formation. Clip ID and
time deterministically perturb that fixture. A `pass` places the synthetic ball
at the target; a `run` places the selected player and ball at the target. It has
no learned behavior, match understanding, physical simulation, expected-goal
meaning, or calibrated prediction. Every successful demo reply identifies
`mode: "synthetic_demo"` and contains an explicit explanatory label. The UI
should display that label and never describe this mode as model inference.

## HTTP contract, version 1.0

Only `GET /health`, `POST /v1/respond`, and browser preflight
`OPTIONS /v1/respond` are implemented. Query strings and all other paths return
404. There are no static-file, dataset, upload, or model routes.

Send UTF-8 JSON with `Content-Type: application/json` and a single
`Content-Length` no greater than 16,384 bytes. Transfer-Encoding is unsupported.
The body has exactly these keys:

```json
{
  "clip_id": "synthetic-clip-a",
  "time_s": 12.5,
  "action": {"kind": "pass", "player": 6, "target": [12.0, -5.0]}
}
```

- `clip_id`: a nonblank string of 1–256 characters, without control characters.
  It is an opaque identifier, never a file path in this service.
- `time_s`: a finite, nonnegative number. The service does not know a clip's
  actual duration; a private adapter must validate its own clip/time access.
- `action.kind`: exactly `pass` or `run`.
- `action.player`: an integer 0–21, corresponding to the returned array index.
  JSON booleans and fractional numbers are rejected.
- `action.target`: exactly two finite numbers `[x, y]` in metres. The pitch is
  centered on `[0, 0]`, with length axis `x` bounded by `[-52.5, 52.5]` and width
  axis `y` by `[-34, 34]`, inclusive. A renderer can map pitch `y` to ground-plane
  `z`. The fixture uses indices 0–10 for one team and 11–21 for the other.

No other request fields are accepted. The client sends identifiers and actions,
not datasets, weights, media, arbitrary paths, or backend module names. Duplicate
JSON keys, NaN, Infinity, out-of-bounds positions, and malformed JSON are rejected.

A successful response is HTTP 200 with exactly these keys:

```text
{
  schema_version: "1.0",
  mode: "synthetic_demo" | "private_adapter",
  clip_id: string,
  time_s: number,
  action: { kind: "pass" | "run", player: integer, target: [number, number] },
  player_positions: [ [x, y], ... ], // exactly 22, array index is player ID
  ball_position: [x, y],
  explanation: string             // 1–1000 characters
}
```

All positions use the same finite, bounded pitch coordinates. `clip_id`, `time_s`,
and `action` echo the normalized validated request. These are single-frame
results; the protocol makes no trajectory or prediction-horizon claim. The
server checks the adapter's result before returning it and rejects extra fields.

Errors have one consistent JSON envelope:

```json
{"error":{"code":"private_backend_unavailable","message":"No private inference backend is available."}}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid JSON, fields, coordinates, or HTTP framing |
| 403 | `origin_not_allowed` / `preflight_not_allowed` | Browser request or preflight denied |
| 404 | `not_found` | Unknown route, including query-string routes |
| 408 | `request_timeout` | Body read exceeded the socket timeout |
| 411 | `length_required` | Missing Content-Length |
| 413 | `body_too_large` | Declared body exceeds 16 KiB |
| 415 | `unsupported_media_type` | Request was not application/json |
| 502 | `backend_failure` | Adapter failed or returned an invalid result |
| 503 | `private_backend_unavailable` | Default mode or adapter-reported unavailability |

Other malformed/unsupported HTTP requests receive a generic `http_error` envelope
with their HTTP status. Responses use `Cache-Control: no-store`. Application
errors contain no stacktrace, exception details, private paths, or input echo;
the server also suppresses per-request and traceback logging. The body-read
timeout is five seconds. All connections close after their response.

## Separately held private Python adapter

Keep the adapter, datasets, and weights **outside the public repository**. Make
the trusted adapter importable through your private Python environment, then run:

```sh
python3 -m service.server --adapter private_adapter:respond \
  --allow-origin http://localhost:5174
```

`--adapter private_adapter` is shorthand for `private_adapter:respond`.
`--demo` and `--adapter` are mutually exclusive. The module is selected once at
startup, never from an HTTP request. Importing it executes trusted local Python
code with the server process's privileges; this is not a sandbox.

The synchronous entry point receives a new, validated dictionary with exactly
the request fields shown above. Numeric time and coordinate values have been
normalized to Python floats. It must return this JSON-compatible dictionary:

```python
def respond(request):
    # Privately resolve and authorize request["clip_id"] and time_s here.
    # Run your separately held backend; never return weights or source records.
    return {
        "player_positions": positions,  # list of exactly 22 [x, y] lists
        "ball_position": ball,          # [x, y] list
        "explanation": explanation,     # string, 1–1000 characters
    }
```

The server adds version, mode, and a copy of the original request to the result.
An adapter can raise `service.BackendUnavailable` for HTTP 503; any other
exception or invalid result produces a generic HTTP 502. Calls are serialized
within this process so a simple adapter is not invoked concurrently. Adapters
own their private resource lifecycle, clip resolution, and authorization; the
prototype does not discover data or load model files for them.

## Tests

From the repository root:

```sh
python3 -m unittest discover -s service/tests -v
```

The tests use random loopback ports and synthetic fixtures only. They exercise
default unavailability, deterministic demo behavior, request and adapter result
validation, strict HTTP framing and body limits, exact CORS, absent file routes,
and generic exception handling. No downloads or third-party packages are needed.

## Limitations and migration

This prototype is for local development. It is deliberately restricted to numeric
loopback addresses (`127.0.0.1` by default; `--host ::1` is also supported).
There is no authentication, TLS, user isolation, rate limiting, durable job
queue, adapter execution deadline, or production concurrency/resource control.
CORS is a browser policy and is **not authentication**. Any process with local
access can call the service, and an allowed development origin can make calls.
Do not expose it with port forwarding or a public tunnel.

A public deployment needs a separately designed, authenticated API boundary and
an explicitly authorized backend/data-access policy. Choose deployment and
identity requirements before replacing this HTTP server; add bounded inference
execution, resource controls, observability that does not expose private data,
and tests for those choices. Keep model loading and private data resolution on
that backend, keep only public identifiers/results in the browser, and retain
explicit mode/version labels so a real backend cannot be confused with the
synthetic demo. This repository intentionally provides no cloud deployment or
claim that those production concerns have already been solved.
