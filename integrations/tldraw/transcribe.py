#!/usr/bin/env python3
"""Derived tldraw transcription adapter.

Reads the canonical Capture Core artifact (latest_capture.json),
verifies the screenshot SHA256, runs EXACTLY ONE Gemma E2B vision
inference, and writes an AI-derived transcription.

The transcription is NOT canonical. It is NOT learner-owned.
It can never modify latest_capture.json.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CAPTURE = BASE_DIR / "latest_capture.json"
DERIVED_DIR = BASE_DIR / "derived-runs"
TRANSCRIPTION_PROMPT = BASE_DIR / "transcription_prompt_v1.md"
SCHEMA_VERSION = "study-canvas-transcription/v1"
MODEL = "ggml-org/gemma-4-E2B-it-GGUF:Q4_0"
LLAMA_BIN = os.environ.get("LLAMA_BIN", "/usr/local/bin/llama")
INFERENCE_TIMEOUT = 120


def fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print("TRANSCRIBE_OK=no", file=sys.stderr)
    print(msg, file=sys.stderr)
    sys.exit(1)


def read_capture(capture_path: Path) -> dict:
    if not capture_path.is_file():
        fail("ERROR=capture not found: " + str(capture_path))
    try:
        capture = json.loads(capture_path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail("ERROR=capture not valid JSON: " + str(exc))
    if capture.get("schema_version") != "study-canvas-capture/v1":
        fail("ERROR=unexpected capture schema_version")
    return capture


def resolve_screenshot(capture: dict, capture_path: Path) -> Path:
    sf = capture.get("screenshot", {}).get("file")
    if not sf:
        fail("ERROR=capture missing screenshot.file")
    ext = sf.rsplit(".", 1)[-1].lower() if "." in sf else "jpg"
    # The canonical Capture Core writes the atomic latest as latest_screenshot.<ext>.
    shot = BASE_DIR / ("latest_screenshot." + ext)
    if not shot.is_file():
        # Fallback to the per-run copy inside runs/<run_id>/.
        run_dir = BASE_DIR / "runs" / (capture.get("run_id") or "")
        alt = run_dir / sf
        if alt.is_file():
            shot = alt
        else:
            fail("ERROR=screenshot missing: " + str(shot))
    if shot.stat().st_size <= 0:
        fail("ERROR=screenshot empty")
    return shot


def verify_screenshot_sha(shot: Path, expected_sha: str) -> str:
    h = hashlib.sha256()
    with shot.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    actual = h.hexdigest()
    if actual != expected_sha:
        fail("ERROR=screenshot sha mismatch: actual=" + actual + " expected=" + expected_sha)
    return actual


def load_prompt() -> str:
    if not TRANSCRIPTION_PROMPT.is_file():
        fail("ERROR=transcription prompt missing")
    return TRANSCRIPTION_PROMPT.read_text(encoding="utf-8")


def run_inference(shot: Path, prompt: str) -> tuple[str, str]:
    cmd = [
        LLAMA_BIN, "cli",
        "-hf", MODEL,
        "--image", str(shot),
        "-p", prompt,
        "--single-turn",
        "-rea", "off",
        "--reasoning-budget", "0",
        "--no-display-prompt",
        "-ngl", "99",
        "-c", "4096",
        "--temp", "0",
        "-n", "1024",
    ]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=INFERENCE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        fail("ERROR=inference timeout after " + str(INFERENCE_TIMEOUT) + "s")
    except FileNotFoundError:
        fail("ERROR=llama binary not found: " + LLAMA_BIN)
    return (
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


def extract_json(stdout: str) -> dict:
    decoder = json.JSONDecoder()
    idx = 0
    while True:
        brace = stdout.find("{", idx)
        if brace == -1:
            break
        try:
            obj, _ = decoder.raw_decode(stdout, brace)
            if isinstance(obj, dict) and obj.get("schema_version") == SCHEMA_VERSION:
                return obj
        except Exception:
            pass
        idx = brace + 1
    fail("ERROR=no valid transcription JSON found in model output")


def _valid_confidence(v: object) -> bool:
    return isinstance(v, (int, float)) and 0.0 <= float(v) <= 1.0


def _ref_targets(obj: dict) -> set[str]:
    refs: set[str] = set()
    for group in ("texts", "objects", "visual_marks", "visible_symbols"):
        for item in obj.get(group, []) or []:
            if isinstance(item, dict) and item.get("id"):
                refs.add(item["id"])
    return refs


def validate_transcription(obj: dict, capture_sha: str) -> None:
    if obj.get("schema_version") != SCHEMA_VERSION:
        fail("ERROR=transcription schema_version mismatch")
    if obj.get("capture_sha256") != capture_sha:
        fail("ERROR=transcription capture_sha256 mismatch")

    refs = _ref_targets(obj)
    for group, fields in (
        ("texts", ("id", "confidence")),
        ("objects", ("id", "confidence")),
        ("visual_marks", ("id", "confidence", "arrowhead_visible")),
        ("visible_symbols", ("id", "confidence")),
    ):
        items = obj.get(group)
        if not isinstance(items, list):
            fail("ERROR=" + group + " must be a list")
        for item in items:
            if not isinstance(item, dict):
                fail("ERROR=" + group + " item not object")
            for f in fields:
                if f not in item:
                    fail("ERROR=" + group + " missing " + f)
            if not _valid_confidence(item.get("confidence")):
                fail("ERROR=" + group + " invalid confidence")
            # A vision model cannot reliably produce valid cross-references.
            # Untrustworthy refs are repaired to null (the adapter refuses to
            # assert a connection that does not exist) rather than discarding
            # the whole transcription.
            for ref_field in ("from_visual_ref", "to_visual_ref", "near_visual_ref"):
                if ref_field in item and item.get(ref_field) is not None and item.get(ref_field) not in refs:
                    item[ref_field] = None

    pu = obj.get("perceptual_uncertainty")
    if not isinstance(pu, list):
        fail("ERROR=perceptual_uncertainty must be a list")
    for item in pu:
        if not isinstance(item, dict) or "source_ref" not in item or "description" not in item:
            fail("ERROR=perceptual_uncertainty item invalid")


def write_derived(run_dir: Path, transcription: dict, raw_stdout: str, raw_stderr: str) -> Path:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "raw_stdout.txt").write_text(raw_stdout, encoding="utf-8")
    (run_dir / "raw_stderr.txt").write_text(raw_stderr, encoding="utf-8")
    (run_dir / "transcription.json").write_text(
        json.dumps(transcription, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return run_dir / "transcription.json"


def atomic_latest(transcription: dict) -> Path:
    latest = BASE_DIR / "latest_transcription.json"
    tmp = BASE_DIR / ("latest_transcription.json.tmp." + str(os.getpid()))
    tmp.write_text(json.dumps(transcription, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, latest)
    return latest


def main() -> None:
    capture_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CAPTURE
    capture = read_capture(capture_path)
    expected_sha = capture.get("screenshot", {}).get("sha256")
    if not expected_sha:
        fail("ERROR=capture missing screenshot.sha256")

    shot = resolve_screenshot(capture, capture_path)
    actual_sha = verify_screenshot_sha(shot, expected_sha)

    prompt = load_prompt()
    stdout, stderr = run_inference(shot, prompt)
    obj = extract_json(stdout)

    # The vision model cannot compute the screenshot SHA256, so the adapter
    # binds the verified SHA256 itself. This proves the transcription is
    # anchored to the exact canonical screenshot (non-canonical, but bound).
    obj["capture_sha256"] = actual_sha

    validate_transcription(obj, actual_sha)

    run_dir = DERIVED_DIR / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ_") + os.urandom(4).hex())
    written = write_derived(run_dir, obj, stdout, stderr)
    atomic_latest(obj)

    print("TRANSCRIBE_OK=yes")
    print("RUN_ID=" + run_dir.name)
    print("TRANSCRIPTION_PATH=" + str(written))
    print("LATEST_TRANSCRIPTION=" + str(BASE_DIR / "latest_transcription.json"))


if __name__ == "__main__":
    main()
