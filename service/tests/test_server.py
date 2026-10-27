from __future__ import annotations

import contextlib
import copy
import http.client
import io
import json
import socket
import threading
import unittest
from unittest.mock import patch

from service.server import (
    MAX_BODY_BYTES,
    BackendUnavailable,
    PrototypeServer,
    load_adapter,
    synthetic_demo,
)


VALID_REQUEST = {
    "clip_id": "synthetic-clip-a",
    "time_s": 12.5,
    "action": {"kind": "pass", "player": 6, "target": [12, -5]},
}


@contextlib.contextmanager
def running_server(**options):
    server = PrototypeServer(("127.0.0.1", 0), **options)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request(server, *, method="POST", path="/v1/respond", body=None, headers=None):
    if body is None:
        body = json.dumps(VALID_REQUEST)
    if isinstance(body, str):
        body = body.encode("utf-8")
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
    connection.request(method, path, body=body, headers=headers or {"Content-Type": "application/json"})
    response = connection.getresponse()
    result = response.status, dict(response.getheaders()), json.loads(response.read())
    connection.close()
    return result


def raw_request(server, headers, body=b""):
    with socket.create_connection(("127.0.0.1", server.server_port), timeout=3) as connection:
        connection.sendall(("POST /v1/respond HTTP/1.1\r\nHost: localhost\r\n" + headers + "\r\n\r\n").encode("ascii") + body)
        response = http.client.HTTPResponse(connection)
        response.begin()
        return response.status, json.loads(response.read())


class HTTPContractTests(unittest.TestCase):
    def assert_error(self, response, status, code):
        actual_status, headers, body = response
        self.assertEqual(actual_status, status)
        self.assertEqual(set(body), {"error"})
        self.assertEqual(set(body["error"]), {"code", "message"})
        self.assertEqual(body["error"]["code"], code)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Traceback", json.dumps(body))

    def test_health_is_alive_but_default_inference_is_unavailable(self):
        with running_server() as server:
            status, _, body = request(server, method="GET", path="/health", body=b"")
            self.assertEqual(status, 200)
            self.assertEqual(body, {"status": "ok", "schema_version": "1.0", "backend": "unavailable"})
            self.assert_error(request(server), 503, "private_backend_unavailable")

    def test_demo_contract_and_repeated_calls_are_deterministic(self):
        with running_server(backend=synthetic_demo, mode="synthetic_demo") as server:
            first = request(server)
            second = request(server)
            self.assertEqual((first[0], first[2]), (second[0], second[2]))
            status, _, body = first
            self.assertEqual(status, 200)
            self.assertEqual(set(body), {
                "schema_version", "mode", "clip_id", "time_s", "action",
                "player_positions", "ball_position", "explanation",
            })
            self.assertEqual(body["schema_version"], "1.0")
            self.assertEqual(body["mode"], "synthetic_demo")
            self.assertEqual(body["clip_id"], VALID_REQUEST["clip_id"])
            self.assertEqual(body["action"], VALID_REQUEST["action"])
            self.assertEqual(body["ball_position"], [12, -5])
            self.assertEqual(len(body["player_positions"]), 22)
            self.assertIn("not a learned prediction", body["explanation"])
            for x, y in body["player_positions"]:
                self.assertLessEqual(abs(x), 52.5)
                self.assertLessEqual(abs(y), 34)

    def test_run_moves_the_chosen_player_and_ball(self):
        payload = copy.deepcopy(VALID_REQUEST)
        payload["action"] = {"kind": "run", "player": 21, "target": [-52.5, 34]}
        with running_server(backend=synthetic_demo, mode="synthetic_demo") as server:
            status, _, body = request(server, body=json.dumps(payload))
            self.assertEqual(status, 200)
            self.assertEqual(body["player_positions"][21], [-52.5, 34])
            self.assertEqual(body["ball_position"], [-52.5, 34])

    def test_invalid_requests_never_reach_the_backend(self):
        calls = []

        def backend(payload):
            calls.append(payload)
            return synthetic_demo(payload)

        invalid = [None, [], {}, "text"]
        for field, value in [
            ("clip_id", ""), ("clip_id", " "), ("clip_id", 1),
            ("clip_id", "a" * 257), ("clip_id", "line\nbreak"),
            ("clip_id", "\ud800"),
            ("time_s", -1), ("time_s", True), ("time_s", "1"),
            ("time_s", float("nan")), ("time_s", float("inf")),
            ("action", None),
        ]:
            payload = copy.deepcopy(VALID_REQUEST)
            payload[field] = value
            invalid.append(payload)
        for field, value in [
            ("kind", "shoot"), ("kind", []), ("player", -1), ("player", 22),
            ("player", 6.0), ("player", True), ("target", [53, 0]),
            ("target", [0, -34.01]), ("target", [0]), ("target", [0, 0, 0]),
            ("target", [True, 0]), ("target", [0, "0"]), ("target", [0, float("nan")]),
        ]:
            payload = copy.deepcopy(VALID_REQUEST)
            payload["action"][field] = value
            invalid.append(payload)
        for extra in ("weights", "dataset", "video", "path"):
            payload = copy.deepcopy(VALID_REQUEST)
            payload[extra] = "never accepted"
            invalid.append(payload)
        payload = copy.deepcopy(VALID_REQUEST)
        payload["action"]["extra"] = 1
        invalid.append(payload)
        with running_server(backend=backend, mode="private_adapter") as server:
            for payload in invalid:
                with self.subTest(payload=payload):
                    self.assert_error(request(server, body=json.dumps(payload)), 400, "invalid_request")
        self.assertEqual(calls, [])

    def test_malformed_json_and_nonfinite_numbers_are_rejected(self):
        invalid_bodies = [
            b"not JSON", b"", b"\xff", b'{"clip_id":"a","clip_id":"b","time_s":0,"action":{}}',
            b'{"clip_id":"a","time_s":1e400,"action":{"kind":"pass","player":0,"target":[0,0]}}',
            b'{"clip_id":"a","time_s":NaN,"action":{"kind":"pass","player":0,"target":[0,0]}}',
            ("[" * 1100 + "]" * 1100).encode("ascii"),
        ]
        with running_server() as server:
            for body in invalid_bodies:
                with self.subTest(body=body[:80]):
                    self.assert_error(request(server, body=body), 400, "invalid_request")

    def test_content_type_and_size_limits(self):
        with running_server() as server:
            self.assert_error(request(server, headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
            self.assert_error(request(server, body=b"x" * (MAX_BODY_BYTES + 1)), 413, "body_too_large")
            # A declaration over the limit is rejected without waiting for a body.
            status, body = raw_request(server, "Content-Type: application/json\r\nContent-Length: 16385")
            self.assertEqual((status, body["error"]["code"]), (413, "body_too_large"))

    def test_framing_is_explicit_and_unambiguous(self):
        invalid = [
            ("Content-Type: application/json", 411, "length_required"),
            ("Content-Type: application/json\r\nContent-Length: -1", 400, "invalid_request"),
            ("Content-Type: application/json\r\nContent-Length: 1\r\nContent-Length: 1", 400, "invalid_request"),
            ("Content-Type: application/json\r\nTransfer-Encoding: chunked", 400, "invalid_request"),
        ]
        with running_server() as server:
            for headers, expected_status, expected_code in invalid:
                with self.subTest(headers=headers):
                    status, body = raw_request(server, headers)
                    self.assertEqual((status, body["error"]["code"]), (expected_status, expected_code))

    def test_default_cors_denies_browser_origins(self):
        with running_server() as server:
            response = request(server, headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"})
            self.assert_error(response, 403, "origin_not_allowed")
            self.assertNotIn("Access-Control-Allow-Origin", response[1])

    def test_cors_allowlist_is_exact_and_has_no_credentials(self):
        origin = "http://localhost:5173"
        with running_server(allowed_origins=(origin,)) as server:
            response = request(server, headers={"Content-Type": "application/json", "Origin": origin})
            self.assert_error(response, 503, "private_backend_unavailable")
            self.assertEqual(response[1]["Access-Control-Allow-Origin"], origin)
            self.assertNotIn("Access-Control-Allow-Credentials", response[1])
            self.assertEqual(response[1]["Vary"], "Origin")
            self.assert_error(request(server, headers={"Content-Type": "application/json", "Origin": "http://localhost:5174"}), 403, "origin_not_allowed")
            self.assert_error(request(server, headers={"Content-Type": "application/json", "Origin": "null"}), 403, "origin_not_allowed")

    def test_preflight_allows_only_the_intended_json_post(self):
        origin = "http://127.0.0.1:5173"
        headers = {"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
        with running_server(allowed_origins=(origin,)) as server:
            status, result_headers, _ = request(server, method="OPTIONS", body=b"", headers=headers)
            self.assertEqual(status, 200)
            self.assertEqual(result_headers["Access-Control-Allow-Origin"], origin)
            self.assertEqual(result_headers["Access-Control-Allow-Headers"], "Content-Type")
            for field, value in [("Access-Control-Request-Method", "DELETE"), ("Access-Control-Request-Headers", "authorization")]:
                with self.subTest(field=field):
                    changed = dict(headers, **{field: value})
                    self.assert_error(request(server, method="OPTIONS", body=b"", headers=changed), 403, "preflight_not_allowed")

    def test_no_routes_expose_files_or_data(self):
        with running_server() as server:
            for path in ("/", "/weights", "/data", "/models", "/../private/model.pt", "/health?file=x", "/v1/respond?file=x"):
                for method in ("GET", "POST"):
                    with self.subTest(path=path, method=method):
                        self.assert_error(request(server, method=method, path=path), 404, "not_found")

    def test_adapter_receives_normalized_data_without_mutating_response_echo(self):
        calls = []

        def adapter(payload):
            calls.append(copy.deepcopy(payload))
            result = synthetic_demo(payload)
            payload["clip_id"] = "mutated"
            payload["action"]["player"] = 0
            return result

        with running_server(backend=adapter, mode="private_adapter") as server:
            status, _, body = request(server)
            self.assertEqual(status, 200)
            self.assertEqual(body["mode"], "private_adapter")
            self.assertEqual(body["clip_id"], VALID_REQUEST["clip_id"])
            self.assertEqual(body["action"]["player"], 6)
            self.assertEqual(calls, [VALID_REQUEST])
            self.assertIsInstance(calls[0]["time_s"], float)
            self.assertIsInstance(calls[0]["action"]["target"][0], float)

    def test_adapter_failures_are_generic_and_do_not_print_details(self):
        def broken(payload):
            raise RuntimeError("SENSITIVE private-model-path and credential detail")

        def absent(payload):
            raise BackendUnavailable("SENSITIVE unavailability detail")

        for backend, expected_status, expected_code in [
            (broken, 502, "backend_failure"), (absent, 503, "private_backend_unavailable"),
        ]:
            with self.subTest(expected_code=expected_code), contextlib.redirect_stderr(io.StringIO()) as stderr:
                with running_server(backend=backend, mode="private_adapter") as server:
                    response = request(server)
                    self.assert_error(response, expected_status, expected_code)
                    self.assertNotIn("SENSITIVE", json.dumps(response))
                self.assertEqual(stderr.getvalue(), "")

    def test_invalid_adapter_results_fail_closed(self):
        valid = synthetic_demo(VALID_REQUEST)
        invalid = [None, [], {**valid, "model_weights": "secret"}]
        for key, value in [
            ("player_positions", valid["player_positions"][:21]),
            ("ball_position", [float("nan"), 0]), ("ball_position", [53, 0]),
            ("explanation", ""), ("explanation", "x" * 1001),
        ]:
            invalid.append({**valid, key: value})
        malformed_players = copy.deepcopy(valid)
        malformed_players["player_positions"][0] = [0, float("inf")]
        invalid.append(malformed_players)
        for result in invalid:
            with self.subTest(result=str(result)[:80]), running_server(backend=lambda _: result, mode="private_adapter") as server:
                self.assert_error(request(server), 502, "backend_failure")

    def test_nonlocal_bind_and_origins_are_rejected(self):
        for host in ("0.0.0.0", "::", "192.168.0.1", "example.com"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                PrototypeServer((host, 0))
        for origin in ("*", "null", "https://example.com", "http://localhost:5173/", "http://user@localhost:5173", "http://localhost.evil:5173", "file://localhost", "http://localhost:0"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                PrototypeServer(("127.0.0.1", 0), allowed_origins=(origin,))

    def test_adapter_module_is_selected_at_startup(self):
        self.assertIs(load_adapter("service.server:synthetic_demo"), synthetic_demo)
        with patch("service.server.importlib.import_module") as load:
            callback = lambda payload: {}
            load.return_value.respond = callback
            self.assertIs(load_adapter("private_adapter"), callback)
            load.assert_called_once_with("private_adapter")
        with self.assertRaises(ValueError):
            load_adapter("service.server:")
        with self.assertRaises(ValueError):
            load_adapter("service.server:SCHEMA_VERSION")


if __name__ == "__main__":
    unittest.main()
