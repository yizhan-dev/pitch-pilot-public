"""A stdlib-only loopback HTTP prototype; not a production inference service."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import ipaddress
import json
import math
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import urlsplit

from service import BackendUnavailable


SCHEMA_VERSION = "1.0"
MAX_BODY_BYTES = 16 * 1024
MAX_RESPONSE_BYTES = 64 * 1024
BODY_TIMEOUT_SECONDS = 5
PITCH_HALF_LENGTH_M = 52.5
PITCH_HALF_WIDTH_M = 34.0
ResponseFunction = Callable[[dict[str, Any]], dict[str, Any]]


class ValidationError(ValueError):
    """The public request or backend result does not satisfy the contract."""


def _finite_number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError("Expected a finite number.")
    try:
        result = float(value)
    except (OverflowError, ValueError):
        raise ValidationError("Expected a finite number.") from None
    if not math.isfinite(result):
        raise ValidationError("Expected a finite number.")
    return result


def _point(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValidationError("Expected a two-number pitch coordinate.")
    x, y = (_finite_number(coordinate) for coordinate in value)
    if abs(x) > PITCH_HALF_LENGTH_M or abs(y) > PITCH_HALF_WIDTH_M:
        raise ValidationError("Coordinate is outside the pitch.")
    return [x, y]


def validate_request(value: Any) -> dict[str, Any]:
    """Return a fresh normalized object; reject unknown fields and booleans."""
    if not isinstance(value, dict) or set(value) != {"clip_id", "time_s", "action"}:
        raise ValidationError("Expected clip_id, time_s, and action only.")
    clip_id = value["clip_id"]
    if (
        not isinstance(clip_id, str)
        or not 1 <= len(clip_id) <= 256
        or not clip_id.strip()
        or any(ord(character) < 32 or ord(character) == 127 for character in clip_id)
    ):
        raise ValidationError("clip_id must be a nonempty string of at most 256 characters.")
    try:
        clip_id.encode("utf-8")
    except UnicodeError:
        raise ValidationError("clip_id must contain valid Unicode characters.") from None
    time_s = _finite_number(value["time_s"])
    if time_s < 0:
        raise ValidationError("time_s must be nonnegative.")
    action = value["action"]
    if not isinstance(action, dict) or set(action) != {"kind", "player", "target"}:
        raise ValidationError("Expected kind, player, and target only.")
    if action["kind"] not in ("pass", "run"):
        raise ValidationError("kind must be pass or run.")
    player = action["player"]
    if isinstance(player, bool) or not isinstance(player, int) or not 0 <= player <= 21:
        raise ValidationError("player must be an integer from 0 through 21.")
    return {
        "clip_id": clip_id,
        "time_s": time_s,
        "action": {"kind": action["kind"], "player": player, "target": _point(action["target"])},
    }


def validate_result(value: Any) -> dict[str, Any]:
    """Keep the browser contract bounded and prevent accidental extra exports."""
    if not isinstance(value, dict) or set(value) != {
        "player_positions", "ball_position", "explanation"
    }:
        raise ValidationError("Invalid backend result fields.")
    players = value["player_positions"]
    if not isinstance(players, list) or len(players) != 22:
        raise ValidationError("Expected exactly 22 player coordinates.")
    explanation = value["explanation"]
    if not isinstance(explanation, str) or not 1 <= len(explanation) <= 1000:
        raise ValidationError("Expected a bounded explanation string.")
    return {
        "player_positions": [_point(position) for position in players],
        "ball_position": _point(value["ball_position"]),
        "explanation": explanation,
    }


def unavailable_backend(request: dict[str, Any]) -> dict[str, Any]:
    raise BackendUnavailable


def synthetic_demo(request: dict[str, Any]) -> dict[str, Any]:
    """Construct an illustrative geometric fixture, with no learned inference."""
    formation = [
        [-48.0, 0.0],
        [-33.0, -24.0], [-33.0, -8.0], [-33.0, 8.0], [-33.0, 24.0],
        [-17.0, -20.0], [-17.0, 0.0], [-17.0, 20.0],
        [-4.0, -18.0], [-4.0, 0.0], [-4.0, 18.0],
    ]
    players = formation + [[-x, -y] for x, y in formation]
    phase = int.from_bytes(hashlib.sha256(request["clip_id"].encode("utf-8")).digest()[:2], "big") / 65536
    for player_id, position in enumerate(players):
        position[1] += math.sin(request["time_s"] / 4.0 + player_id + phase) * 1.5
    action = request["action"]
    target = list(action["target"])
    if action["kind"] == "run":
        players[action["player"]] = list(target)
    return {
        "player_positions": players,
        "ball_position": target,
        "explanation": (
            "Synthetic demo fixture only. No match video, trained model, or private "
            "data was used. The requested action is applied geometrically; this is "
            "not a learned prediction."
        ),
    }


def _local_origin(origin: str) -> bool:
    """Only explicit HTTP(S) origins on localhost or numeric loopback are allowed."""
    try:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or (parsed.port is not None and not 1 <= parsed.port <= 65535)
        ):
            return False
        if parsed.hostname != "localhost" and not ipaddress.ip_address(parsed.hostname).is_loopback:
            return False
        # Reject malformed ports and origin spellings which browsers never emit.
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        normalized = f"{parsed.scheme}://{host}"
        if parsed.port is not None:
            normalized += f":{parsed.port}"
        return normalized == origin
    except ValueError:
        return False


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("Duplicate JSON keys are not allowed.")
        result[key] = value
    return result


def _reject_constant(value: str) -> Any:
    raise ValidationError("Nonfinite JSON values are not allowed.")


class PrototypeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        *,
        backend: ResponseFunction = unavailable_backend,
        mode: str = "unavailable",
        allowed_origins: tuple[str, ...] = (),
    ) -> None:
        host, port = address
        try:
            host_ip = ipaddress.ip_address(host)
        except ValueError:
            raise ValueError("Bind address must be a numeric loopback address.") from None
        if not host_ip.is_loopback:
            raise ValueError("Bind address must be a numeric loopback address.")
        if any(not _local_origin(origin) for origin in allowed_origins):
            raise ValueError("CORS origins must be exact local HTTP(S) origins.")
        if mode not in {"unavailable", "synthetic_demo", "private_adapter"}:
            raise ValueError("Unknown backend mode.")
        self.backend = backend
        self.mode = mode
        self.allowed_origins = frozenset(allowed_origins)
        self.backend_lock = threading.Lock()
        self.address_family = socket.AF_INET6 if host_ip.version == 6 else socket.AF_INET
        super().__init__((host, port), RequestHandler)

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Avoid BaseServer printing tracebacks or client-specific details.
        pass


class RequestHandler(BaseHTTPRequestHandler):
    server: PrototypeServer
    protocol_version = "HTTP/1.1"
    server_version = "LocalPrototype"
    sys_version = ""

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(BODY_TIMEOUT_SECONDS)

    def log_message(self, format: str, *args: Any) -> None:
        # Deliberately avoid logging clip ids, payloads, or backend exceptions.
        pass

    def _origin(self) -> str | None:
        headers = getattr(self, "headers", None)
        origins = headers.get_all("Origin", []) if headers is not None else []
        return origins[0] if len(origins) == 1 else None

    def _allow_origin(self) -> bool:
        origins = self.headers.get_all("Origin", [])
        if not origins:
            return True  # Local command-line clients need no browser CORS grant.
        if len(origins) == 1 and origins[0] in self.server.allowed_origins:
            return True
        self._error(403, "origin_not_allowed", "This browser origin is not allowed.")
        return False

    def _json(self, status: int, payload: Any, extra_headers: dict[str, str] | None = None) -> None:
        data = json.dumps(payload, allow_nan=False, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        if len(data) > MAX_RESPONSE_BYTES:
            status = 502
            data = b'{"error":{"code":"backend_failure","message":"The private backend could not produce a valid response."}}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.send_header("Vary", "Origin")
        origin = self._origin()
        if origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(data)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message}})

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        self._error(code, "http_error", "The HTTP request could not be handled.")

    def do_GET(self) -> None:
        if not self._allow_origin():
            return
        if self.path != "/health":
            self._error(404, "not_found", "Route not found.")
            return
        self._json(200, {"status": "ok", "schema_version": SCHEMA_VERSION, "backend": self.server.mode})

    def do_OPTIONS(self) -> None:
        if not self._allow_origin():
            return
        if self.path != "/v1/respond":
            self._error(404, "not_found", "Route not found.")
            return
        requested_headers = {
            header.strip().lower()
            for header in self.headers.get("Access-Control-Request-Headers", "").split(",")
            if header.strip()
        }
        if (
            self._origin() is None
            or self.headers.get("Access-Control-Request-Method") != "POST"
            or not requested_headers.issubset({"content-type"})
        ):
            self._error(403, "preflight_not_allowed", "This CORS preflight is not allowed.")
            return
        self._json(200, {"status": "ok"}, {
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        })

    def do_POST(self) -> None:
        if not self._allow_origin():
            return
        if self.path != "/v1/respond":
            self._error(404, "not_found", "Route not found.")
            return
        if self.headers.get_all("Transfer-Encoding"):
            self._error(400, "invalid_request", "Transfer-Encoding is not supported.")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if not lengths:
            self._error(411, "length_required", "Content-Length is required.")
            return
        if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            self._error(400, "invalid_request", "Content-Length must be a single nonnegative integer.")
            return
        # Bound the header before int() as well as the body before reading it.
        if len(lengths[0]) > 8 or int(lengths[0]) > MAX_BODY_BYTES:
            self._error(413, "body_too_large", "The JSON body exceeds 16384 bytes.")
            return
        if self.headers.get_content_type() != "application/json":
            self._error(415, "unsupported_media_type", "Content-Type must be application/json.")
            return
        length = int(lengths[0])
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValidationError("The body is incomplete.")
            value = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
            request = validate_request(value)
        except (UnicodeError, ValueError, RecursionError):
            self._error(400, "invalid_request", "The body must match the documented JSON request contract.")
            return
        except (TimeoutError, OSError):
            self._error(408, "request_timeout", "The request body could not be read in time.")
            return
        try:
            # A private adapter sees a separate copy and is never called concurrently.
            with self.server.backend_lock:
                result = validate_result(self.server.backend(copy.deepcopy(request)))
            self._json(200, {"schema_version": SCHEMA_VERSION, "mode": self.server.mode, **request, **result})
        except BackendUnavailable:
            self._error(503, "private_backend_unavailable", "No private inference backend is available.")
        except Exception:
            self._error(502, "backend_failure", "The private backend could not produce a valid response.")


def load_adapter(specification: str) -> ResponseFunction:
    module_name, separator, attribute = specification.partition(":")
    if not module_name or (separator and not attribute):
        raise ValueError("Use module_name or module_name:callable_name.")
    module = importlib.import_module(module_name)
    callback = getattr(module, attribute or "respond")
    if not callable(callback):
        raise ValueError("The adapter entry point must be callable.")
    return callback


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1", help="numeric loopback address only (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765)
    backend_options = parser.add_mutually_exclusive_group()
    backend_options.add_argument("--demo", action="store_true", help="explicitly enable synthetic geometry; no trained inference")
    backend_options.add_argument("--adapter", metavar="MODULE[:CALLABLE]", help="trusted, separately held local Python adapter")
    parser.add_argument("--allow-origin", action="append", default=[], help="exact local browser origin; repeat for each allowed origin")
    args = parser.parse_args()
    backend, mode = unavailable_backend, "unavailable"
    try:
        if args.demo:
            backend, mode = synthetic_demo, "synthetic_demo"
        elif args.adapter:
            backend, mode = load_adapter(args.adapter), "private_adapter"
        server = PrototypeServer((args.host, args.port), backend=backend, mode=mode, allowed_origins=tuple(args.allow_origin))
    except Exception:
        parser.exit(2, "Could not start local prototype. Check bind address, port, origins, and adapter configuration.\n")
    address = server.server_address
    host = f"[{address[0]}]" if ":" in address[0] else address[0]
    print(f"Local prototype listening on http://{host}:{address[1]} ({mode}); not production-ready.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
