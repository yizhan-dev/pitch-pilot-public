#!/usr/bin/env python3
"""Audit a candidate public export using only the Python standard library.

This is a release guard, not proof that arbitrary assets have public provenance.
JSON model data is permitted only when explicitly declared to be a synthetic
fixture: use ``synthetic: true`` plus ``fixture: true``, place a JSON file with
``synthetic: true`` below a ``fixtures`` directory, or use
``kind: "synthetic-fixture"``. Declarations belong at the document's top level.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import stat
from typing import Any


IGNORED_DIRS = frozenset(
    {".git", "node_modules", ".venv", "dist", "__pycache__", "build", ".pytest_cache"}
)
FORBIDDEN_ROOTS = (
    ("private",),
    ("engine",),
    ("probe",),
    ("models",),
    ("data",),
    ("runs",),
    ("web", "public", "data"),
)
MODEL_SUFFIXES = frozenset(
    {".pt", ".pth", ".ckpt", ".safetensors", ".onnx", ".npy", ".npz", ".pkl", ".pickle", ".bin"}
)

# Keep reports generic: neither matched values nor surrounding lines are emitted.
SECRET_PATTERNS = (
    (
        "PEM private key material",
        re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    ),
    ("GitHub token pattern", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("GitHub token pattern", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("OpenAI token pattern", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b")),
    ("AWS access key pattern", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("Slack token pattern", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key pattern", re.compile(r"\bAIza[A-Za-z0-9_-]{35}\b")),
    ("npm token pattern", re.compile(r"\bnpm_[A-Za-z0-9]{36,}\b")),
    ("Hugging Face token pattern", re.compile(r"\bhf_[A-Za-z0-9]{20,}\b")),
    ("Stripe live key pattern", re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b")),
)

# Construct the roots without embedding literal host paths in this public file.
_INTERNAL_ROOTS = ("storage", "home/liyi", "Users/yi")
INTERNAL_PATH_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_./:\\-])/"
    + "(?:"
    + "|".join(re.escape(root) for root in _INTERNAL_ROOTS)
    + r")(?:/|(?=$|[\s\"'`),;\]}]))"
)


@dataclass(frozen=True)
class Finding:
    path: str
    reason: str


@dataclass
class AuditResult:
    files_scanned: int = 0
    findings: list[Finding] = field(default_factory=list)


def _forbidden_path(relative: Path) -> bool:
    return any(relative.parts[: len(prefix)] == prefix for prefix in FORBIDDEN_ROOTS)


def _contains_number(value: Any) -> bool:
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, (int, float)) and not isinstance(current, bool):
            return True
        if isinstance(current, dict):
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
    return False


def _model_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.casefold())
    return normalized in {"statedict", "parameters", "kernel", "kernels", "bias", "biases"} or normalized.endswith(
        ("weight", "weights", "tensor", "tensors")
    )


def _synthetic_fixture(document: Any, relative: Path) -> bool:
    if not isinstance(document, dict):
        return False
    if document.get("kind") in ("synthetic-fixture", "synthetic_fixture"):
        return True
    return document.get("synthetic") is True and (
        document.get("fixture") is True or "fixtures" in relative.parts[:-1]
    )


def _numeric_model_data(document: Any, relative: Path) -> bool:
    if _model_key(relative.stem) and _contains_number(document):
        return True
    pending = [document]
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            for key, value in current.items():
                if _model_key(key) and _contains_number(value):
                    return True
                pending.append(value)
        elif isinstance(current, list):
            pending.extend(current)
    return False


def _read_regular_file(path: Path) -> bytes:
    """Open without following file symlinks; never open a FIFO or device."""
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise OSError("not a regular file")
        return stream.read()


def _audit_file(path: Path, relative: Path, result: AuditResult) -> None:
    display_path = relative.as_posix()

    def report(reason: str) -> None:
        result.findings.append(Finding(display_path, reason))

    result.files_scanned += 1
    name = path.name.casefold()
    if path.suffix.casefold() in MODEL_SUFFIXES:
        report("trained-model or serialized-data file extension")
    if (name == ".env" or name.startswith(".env.")) and name != ".env.example":
        report("environment file; only .env.example is allowed")
    if name == "release-scrub.json":
        report("private release mapping file")

    try:
        payload = _read_regular_file(path)
    except OSError:
        report("file could not be read safely")
        return

    # Replacement decoding preserves ASCII secret patterns without raising on
    # binary images, fonts, or malformed UTF-8. No file contents enter reports.
    text = payload.decode("utf-8", errors="replace")
    for reason, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            report(reason)
    if INTERNAL_PATH_PATTERN.search(text.replace("\\/", "/")):
        report("literal internal absolute path")

    if path.suffix.casefold() == ".json":
        try:
            document = json.loads(payload)
        except (ValueError, UnicodeError, RecursionError):
            report("invalid JSON; numeric model data could not be inspected")
            return
        if _numeric_model_data(document, relative) and not _synthetic_fixture(document, relative):
            report("numeric JSON weights or tensors without an explicit synthetic-fixture label")


def audit_tree(root: str | Path) -> AuditResult:
    """Inspect a candidate export without following symlinks.

    Ignored runtime directories are pruned before inspection, including a link
    occupying an ignored directory name. Forbidden roots are reported and
    pruned, so their private contents need not be opened to fail the audit.
    """
    root = Path(root).absolute()
    result = AuditResult()
    try:
        root_mode = root.lstat().st_mode
    except OSError:
        result.findings.append(Finding(".", "audit root is unavailable"))
        return result
    if stat.S_ISLNK(root_mode):
        result.findings.append(Finding(".", "symlink audit root is forbidden"))
        return result
    if not stat.S_ISDIR(root_mode):
        result.findings.append(Finding(".", "audit root must be a directory"))
        return result

    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            with os.scandir(directory) as iterator:
                entries = sorted(iterator, key=lambda entry: entry.name)
        except OSError:
            relative = directory.relative_to(root).as_posix()
            result.findings.append(Finding(relative, "directory could not be inspected safely"))
            continue
        for entry in entries:
            relative = Path(entry.path).relative_to(root)
            display_path = relative.as_posix()
            try:
                is_link = entry.is_symlink()
                is_directory = entry.is_dir(follow_symlinks=False)
                if entry.name in IGNORED_DIRS and (is_link or is_directory):
                    continue
                if is_link:
                    result.findings.append(Finding(display_path, "symlink is forbidden"))
                    continue
                if _forbidden_path(relative):
                    result.findings.append(Finding(display_path, "forbidden private export root"))
                    continue
                if is_directory:
                    pending.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    _audit_file(Path(entry.path), relative, result)
                else:
                    result.findings.append(Finding(display_path, "nonregular filesystem entry is forbidden"))
            except OSError:
                result.findings.append(Finding(display_path, "entry could not be inspected safely"))

    result.findings.sort(key=lambda finding: (finding.path, finding.reason))
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=Path(__file__).absolute().parents[1],
        help="candidate export directory (default: repository containing this script)",
    )
    arguments = parser.parse_args(argv)
    result = audit_tree(arguments.root)
    for finding in result.findings:
        # JSON quoting makes unusual filenames unambiguous and keeps one line
        # per finding, while still revealing only the path and rule name.
        print(f"{json.dumps(finding.path, ensure_ascii=True)}: {finding.reason}")
    status = "FAIL" if result.findings else "PASS"
    print(f"{status}: {result.files_scanned} files scanned; {len(result.findings)} violations.")
    return 1 if result.findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
