"""Synthetic, temporary-directory tests for the public-export guard."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).absolute().parents[1] / "scripts" / "audit_public.py"
SPEC = importlib.util.spec_from_file_location("audit_public_under_test", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
audit = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


class PublicAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def write(self, relative: str, content: str | bytes = "safe\n") -> Path:
        destination = self.root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            destination.write_bytes(content)
        else:
            destination.write_text(content, encoding="utf-8")
        return destination

    def findings(self) -> list:
        return audit.audit_tree(self.root).findings

    def test_clean_source_docs_and_distinct_asset_suffixes_pass(self) -> None:
        self.write("src/main.js", "export const answer = 42;\n")
        self.write(
            "README.md",
            "Keep private/, engine/, probe/, models/, data/, runs/ and "
            "web/public/data out of releases. release-scrub.json is internal.\n"
            "A public URL is https://example.test/storage/demo.\n",
        )
        self.write(".env.example", "API_URL=https://example.test\nAPI_TOKEN=\n")
        self.write("public/font.woff2", b"\x00\xff\xfe\x80")
        self.write("public/logo.png", b"\x89PNG\r\n\x1a\n")
        self.write("public/shape.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
        result = audit.audit_tree(self.root)
        self.assertEqual(result.findings, [])
        self.assertEqual(result.files_scanned, 6)

    def test_forbidden_roots_fail_even_when_empty(self) -> None:
        roots = ["private", "engine", "probe", "models", "data", "runs", "web/public/data"]
        for relative in roots:
            (self.root / relative).mkdir(parents=True)
        self.assertEqual({finding.path for finding in self.findings()}, set(roots))

    def test_forbidden_roots_are_pruned_without_opening_contents(self) -> None:
        self.write("private/hidden.txt", "ghp_" + "A" * 36)
        findings = self.findings()
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].path, "private")

    def test_runtime_directories_are_ignored_at_any_depth(self) -> None:
        for directory in audit.IGNORED_DIRS:
            self.write(f"nested/{directory}/secret.pt", "ghp_" + "A" * 36)
        self.assertEqual(self.findings(), [])

    def test_symlinks_fail_without_following_targets(self) -> None:
        self.write("okay.txt")
        (self.root / "linked.txt").symlink_to(self.root / "okay.txt")
        (self.root / "dangling").symlink_to(self.root / "missing")
        (self.root / "loop").symlink_to(self.root, target_is_directory=True)
        findings = self.findings()
        self.assertEqual({finding.path for finding in findings}, {"linked.txt", "dangling", "loop"})
        self.assertTrue(all("symlink" in finding.reason for finding in findings))
        self.assertEqual(audit.audit_tree(self.root).files_scanned, 1)

    def test_symlinks_under_ignored_runtime_directories_are_ignored(self) -> None:
        self.write("node_modules/package/file.txt")
        (self.root / "node_modules" / "package" / "link").symlink_to(self.root)
        (self.root / "dist").symlink_to(self.root / "missing", target_is_directory=True)
        self.assertEqual(self.findings(), [])

    def test_symlink_root_is_rejected(self) -> None:
        link = self.root / "root-link"
        link.symlink_to(self.root, target_is_directory=True)
        result = audit.audit_tree(link)
        self.assertEqual(result.files_scanned, 0)
        self.assertIn("symlink", result.findings[0].reason)

    def test_model_extensions_fail_case_insensitively(self) -> None:
        for suffix in audit.MODEL_SUFFIXES:
            self.write("assets/model" + suffix.upper(), b"\x00\xff")
        findings = self.findings()
        self.assertEqual(len(findings), len(audit.MODEL_SUFFIXES))
        self.assertTrue(all("extension" in finding.reason for finding in findings))

    def test_environment_files_fail_except_exact_example(self) -> None:
        forbidden = [".env", ".env.local", ".env.production", ".env.example.local"]
        for name in forbidden + [".env.example"]:
            self.write(name, "NOT_A_SECRET=\n")
        self.assertEqual({finding.path for finding in self.findings()}, set(forbidden))

    def test_example_environment_contents_are_still_inspected(self) -> None:
        self.write(".env.example", "TOKEN=" + "ghp_" + "A" * 36)
        self.assertIn("token pattern", self.findings()[0].reason)

    def test_private_mapping_name_fails_but_documentation_mentions_pass(self) -> None:
        self.write("tools/release-scrub.json", "{}")
        self.write("README.md", "The private mapping is named release-scrub.json.")
        self.assertEqual([finding.path for finding in self.findings()], ["tools/release-scrub.json"])

    def test_pem_private_keys_fail_but_public_keys_pass(self) -> None:
        self.write("keys/private.txt", "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nplaceholder\n")
        self.write("keys/public.txt", "-----BEGIN PUBLIC KEY-----\nplaceholder\n")
        findings = self.findings()
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].reason, "PEM private key material")

    def test_known_token_patterns_fail_without_disclosing_values(self) -> None:
        tokens = [
            "ghp_" + "A" * 36,
            "github_pat_" + "A" * 40,
            "sk-proj-" + "A" * 40,
            "AKIA" + "A" * 16,
            "xoxb-" + "1234567890-" * 3,
            "AIza" + "A" * 35,
            "npm_" + "A" * 36,
            "hf_" + "A" * 30,
            "sk_live_" + "A" * 30,
        ]
        for index, token in enumerate(tokens):
            self.write(f"src/token_{index}.txt", token)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = audit.main([str(self.root)])
        self.assertEqual(exit_code, 1)
        self.assertEqual(len(self.findings()), len(tokens))
        for token in tokens:
            self.assertNotIn(token, output.getvalue())
        self.assertIn("FAIL:", output.getvalue())

    def test_literal_internal_paths_fail_but_relative_paths_and_urls_pass(self) -> None:
        paths = ["/" + "storage" + "/project/file", "/home/" + "liyi" + "/repo", "/Users/" + "yi" + "/repo"]
        for index, value in enumerate(paths):
            self.write(f"paths/{index}.txt", f'const local = "{value}";')
        self.write(
            "README.md",
            "private/foo engine/foo web/public/data/foo storage/foo "
            "https://example.test/storage/foo https://example.test/home/liyi/foo",
        )
        self.assertEqual({finding.path for finding in self.findings()}, {"paths/0.txt", "paths/1.txt", "paths/2.txt"})

    def test_json_escaped_internal_path_is_detected(self) -> None:
        value = "/" + "storage" + "/file"
        self.write("path.json", json.dumps({"path": value}).replace("/", "\\/"))
        self.assertIn("absolute path", self.findings()[0].reason)

    def test_numeric_json_model_keys_are_detected_recursively(self) -> None:
        documents = [
            {"weights": [[0.1, 0.2]]},
            {"model": {"layer.weight": [0.1]}},
            {"tensors": {"layer": [1.0]}},
            {"state_dict": {"layer": [2.0]}},
            {"kernel": [[3.0]]},
        ]
        for index, document in enumerate(documents):
            self.write(f"assets/model_{index}.json", json.dumps(document))
        self.assertEqual(len(self.findings()), len(documents))

    def test_model_named_json_file_with_numeric_array_fails(self) -> None:
        self.write("assets/network-weights.json", "[[0.1, 0.2]]")
        self.assertIn("numeric JSON", self.findings()[0].reason)

    def test_explicit_synthetic_fixtures_pass(self) -> None:
        self.write("tests/fixtures/sample.json", json.dumps({"synthetic": True, "weights": [0.1]}))
        self.write("demo.json", json.dumps({"synthetic": True, "fixture": True, "tensors": [[1, 2]]}))
        self.write("example.json", json.dumps({"kind": "synthetic-fixture", "weights": [0.2]}))
        self.assertEqual(self.findings(), [])

    def test_incidental_synthetic_labels_do_not_exempt_model_data(self) -> None:
        documents = [
            {"synthetic": True, "weights": [0.1]},
            {"synthetic": "true", "fixture": True, "weights": [0.2]},
            {"description": "synthetic fixture", "weights": [0.3]},
            {"metadata": {"synthetic": True, "fixture": True}, "weights": [0.4]},
        ]
        for index, document in enumerate(documents):
            self.write(f"assets/example_{index}.json", json.dumps(document))
        self.assertEqual(len(self.findings()), len(documents))

    def test_structured_kind_value_does_not_crash_the_audit(self) -> None:
        self.write("assets/example.json", json.dumps({"kind": [], "weights": [0.1]}))
        self.assertEqual(len(self.findings()), 1)
        self.assertIn("numeric JSON", self.findings()[0].reason)

    def test_model_metadata_without_numeric_model_contents_passes(self) -> None:
        self.write("config.json", json.dumps({"version": 1, "weights": "provided by API", "tensors": [], "ready": True}))
        self.assertEqual(self.findings(), [])

    def test_invalid_bytes_are_safe_and_ascii_tokens_remain_detectable(self) -> None:
        self.write("invalid.txt", b"\xff\xfe" + ("ghp_" + "A" * 36).encode("ascii"))
        self.assertEqual(len(self.findings()), 1)

    def test_invalid_json_fails_closed(self) -> None:
        self.write("broken.json", b"\xffnot-json")
        self.assertIn("invalid JSON", self.findings()[0].reason)

    def test_missing_or_file_root_fails(self) -> None:
        self.assertTrue(audit.audit_tree(self.root / "missing").findings)
        regular = self.write("regular.txt")
        self.assertTrue(audit.audit_tree(regular).findings)

    def test_clean_cli_has_success_status(self) -> None:
        self.write("README.md")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = audit.main([str(self.root)])
        self.assertEqual(exit_code, 0)
        self.assertEqual(output.getvalue(), "PASS: 1 files scanned; 0 violations.\n")


if __name__ == "__main__":
    unittest.main()
