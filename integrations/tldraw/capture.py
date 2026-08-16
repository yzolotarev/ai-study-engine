#!/usr/bin/env python3
"""tldraw Capture Core v1.

Captures the focused tldraw document (screenshot + compact metadata)
through the official local tldraw Canvas API.

NO AI. NO OCR. NO semantic interpretation. NO decoded draw paths.

Canonical learner artifact = latest_capture.json + latest_screenshot.*.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from shutil import copy2

BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
SERVER_JSON = Path(
    os.environ.get(
        "TLDRAW_SERVER_JSON",
        str(Path.home() / ".config" / "tldraw" / "server.json"),
    )
)
SCHEMA_VERSION = "study-canvas-capture/v1"
MANIFEST_VERSION = "study-canvas-manifest/v1"

LATEST_CAPTURE = BASE_DIR / "latest_capture.json"
LATEST_MANIFEST = BASE_DIR / "latest_manifest.json"

FORBIDDEN_KEYS = {
    "segment",
    "segments",
    "path",
    "paths",
    "point",
    "points",
    "raw",
    "rawpoints",
    "raw_points",
}

# --- tldraw Local Canvas API search code (run inside the tldraw API context) ---

FOCUSED_DOC_CODE = """
const d = await api.getFocusedDoc();
return d ? { id: d.id, name: (d.name === undefined ? null : d.name) } : null;
"""

SCREENSHOT_CODE = """
const d = await api.getFocusedDoc();
if (!d) return null;
return await api.getScreenshot(d.id, { size: "medium", mode: "canvas" });
"""

SHAPES_CODE = """
const d = await api.getFocusedDoc();
if (!d) return null;
const page = await api.getShapes(d.id);
const shapes = (page.shapes || []).map(function(s){
  const p = s.props || {};
  const props = {};
  const allowed = ["w","h","color","fill","size","name"];
  for (let i=0;i<allowed.length;i++){
    const k = allowed[i];
    if (p[k] !== undefined && p[k] !== null && typeof p[k] !== "object"){
      props[k] = p[k];
    }
  }
  let textVal = null;
  if (typeof p.text === "string"){
    textVal = p.text;
  } else if (p.richText){
    try { textVal = helpers.richTextToPlainText(p.richText); } catch(e){ textVal = null; }
  }
  if (textVal !== null && textVal !== undefined){
    props.text = (typeof textVal === "string" ? textVal : null);
  }
  let bounds = null;
  if (s.bounds && typeof s.bounds === "object"){
    bounds = {
      x: (typeof s.bounds.x === "number" ? s.bounds.x : null),
      y: (typeof s.bounds.y === "number" ? s.bounds.y : null),
      w: (typeof s.bounds.w === "number" ? s.bounds.w : null),
      h: (typeof s.bounds.h === "number" ? s.bounds.h : null)
    };
  } else if (typeof s.x === "number" && typeof s.y === "number" && typeof p.w === "number" && typeof p.h === "number"){
    bounds = { x: s.x, y: s.y, w: p.w, h: p.h };
  }
  return {
    id: s.id,
    type: (s.type === undefined ? null : s.type),
    x: (typeof s.x === "number" ? s.x : null),
    y: (typeof s.y === "number" ? s.y : null),
    rotation: (typeof s.rotation === "number" ? s.rotation : null),
    bounds: bounds,
    props: props
  };
});
return { doc: { id: d.id, name: (d.name === undefined ? null : d.name) }, shapes: shapes };
"""

BINDINGS_CODE = """
const d = await api.getFocusedDoc();
if (!d) return [];
const bs = await api.getBindings(d.id);
return (bs || []).map(function(b){
  return {
    id: (b.id === undefined ? null : b.id),
    type: (b.type === undefined ? null : b.type),
    from_id: (b.fromId === undefined ? null : b.fromId),
    to_id: (b.toId === undefined ? null : b.toId)
  };
});
"""


def fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print("CAPTURE_OK=no", file=sys.stderr)
    print(msg, file=sys.stderr)
    if run_dir is not None and run_dir.exists():
        try:
            (run_dir / "FAILED").write_text(msg + "\n", encoding="utf-8")
        except Exception:
            pass
    sys.exit(1)


run_dir: "Path | None" = None


def read_server() -> tuple[int, str]:
    if not SERVER_JSON.is_file():
        fail("ERROR=server.json missing: " + str(SERVER_JSON))
    try:
        cfg = json.loads(SERVER_JSON.read_text(encoding="utf-8"))
    except Exception as exc:
        fail("ERROR=cannot parse server.json: " + str(exc))
    port = cfg.get("port")
    token = cfg.get("token")
    if not isinstance(port, int) or not isinstance(token, str) or not token:
        fail("ERROR=cannot read port or token from server.json")
    return port, token


def check_readme(base_url: str) -> None:
    try:
        req = urllib.request.Request(base_url + "/readme", method="GET")
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status != 200:
                fail("ERROR=tldraw API not reachable (/readme status " + str(r.status) + ")")
    except urllib.error.URLError as exc:
        fail("ERROR=tldraw API unavailable: " + str(exc))
    except Exception as exc:
        fail("ERROR=tldraw API check failed: " + str(exc))


def api_search(base_url: str, token: str, code: str):
    url = base_url + "/api/search"
    body = json.dumps({"code": code}).encode("utf-8")
    headers = {
        "authorization": "Bearer " + token,
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            status = r.status
            raw = r.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        fail("ERROR=api search HTTP " + str(exc.code))
    except urllib.error.URLError as exc:
        fail("ERROR=api search connection failed: " + str(exc))
    if status != 200:
        fail("ERROR=api search status " + str(status))
    if not raw:
        fail("ERROR=api search empty response")
    try:
        data = json.loads(raw)
    except Exception:
        fail("ERROR=api search response not JSON")
    if not data.get("success"):
        err = data.get("error")
        fail("ERROR=api search failed: " + (str(err) if err else "unknown"))
    return data.get("result")


def sha256_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def detect_extension(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"\x89PNG":
        return "png"
    fail("ERROR=unsupported screenshot format (not JPEG/PNG)")


def check_forbidden(obj, path: str = "") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() in FORBIDDEN_KEYS:
                fail("ERROR=forbidden raw key in metadata: " + str(k) + " at " + path)
            check_forbidden(v, path + "/" + str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            check_forbidden(v, path + "[" + str(i) + "]")


def validate_capture(capture: dict, run_dir: Path) -> None:
    if capture.get("schema_version") != SCHEMA_VERSION:
        fail("ERROR=schema_version mismatch")
    if not capture.get("run_id"):
        fail("ERROR=run_id empty")
    if not capture.get("captured_at"):
        fail("ERROR=captured_at empty")
    doc = capture.get("document") or {}
    if not doc.get("id"):
        fail("ERROR=document.id empty")
    shapes = capture.get("shapes") or []
    bindings = capture.get("bindings") or []
    if doc.get("shape_count") != len(shapes):
        fail("ERROR=shape_count mismatch")
    if doc.get("binding_count") != len(bindings):
        fail("ERROR=binding_count mismatch")
    shot = capture.get("screenshot") or {}
    sf = shot.get("file")
    if not sf:
        fail("ERROR=screenshot.file missing")
    sfp = run_dir / sf
    if not sfp.is_file():
        fail("ERROR=screenshot file not inside run dir")
    actual_sha, actual_size = sha256_file(sfp)
    if shot.get("bytes") != actual_size:
        fail("ERROR=screenshot bytes mismatch")
    if shot.get("sha256") != actual_sha:
        fail("ERROR=screenshot sha256 mismatch")
    if len(actual_sha) != 64 or any(c not in "0123456789abcdef" for c in actual_sha):
        fail("ERROR=screenshot sha256 format invalid")
    ids = [s.get("id") for s in shapes]
    if any(not i for i in ids):
        fail("ERROR=shape id empty")
    if len(set(ids)) != len(ids):
        fail("ERROR=shape ids not unique")
    check_forbidden(capture)


def atomic_write(target: Path, data: bytes) -> None:
    tmp = target.with_suffix(target.suffix + ".tmp-" + secrets.token_hex(4))
    with tmp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)


def make_run_id() -> str:
    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d-%H%M%S")
    return stamp + "-" + secrets.token_hex(4)


def main() -> int:
    global run_dir
    json_mode = "--json" in sys.argv[1:]

    port, token = read_server()
    base_url = "http://127.0.0.1:" + str(port)

    check_readme(base_url)

    fd = api_search(base_url, token, FOCUSED_DOC_CODE)
    if not fd or not fd.get("id"):
        fail("ERROR=no focused tldraw document")
    doc_id = fd["id"]
    doc_name = fd.get("name")

    shot = api_search(base_url, token, SCREENSHOT_CODE)
    if not shot or not shot.get("filePath"):
        fail("ERROR=screenshot not returned by API")
    shot_path = Path(shot["filePath"])
    if not shot_path.is_file():
        fail("ERROR=screenshot file missing: " + str(shot_path))
    if shot_path.stat().st_size <= 0:
        fail("ERROR=screenshot file is empty")

    shapes_result = api_search(base_url, token, SHAPES_CODE)
    if not shapes_result or not isinstance(shapes_result.get("shapes"), list):
        fail("ERROR=shapes not returned by API")
    raw_shapes = shapes_result["shapes"]
    if len(raw_shapes) == 0:
        fail("ERROR=focused tldraw document is empty")

    bindings_result = api_search(base_url, token, BINDINGS_CODE)
    if not isinstance(bindings_result, list):
        fail("ERROR=bindings not returned by API")
    compact_shapes = raw_shapes
    compact_bindings = bindings_result

    check_forbidden(compact_shapes)

    run_id = make_run_id()
    run_dir = RUNS_DIR / run_id
    if run_dir.exists():
        fail("ERROR=run directory already exists: " + run_id)
    run_dir.mkdir(parents=True, exist_ok=False)

    shot_data = shot_path.read_bytes()
    ext = detect_extension(shot_data)
    shot_name = "screenshot." + ext
    shot_dst = run_dir / shot_name
    copy2(shot_path, shot_dst)
    shot_sha, shot_size = sha256_file(shot_dst)

    captured_at = datetime.now(timezone.utc).astimezone().isoformat()

    capture = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "captured_at": captured_at,
        "document": {
            "id": doc_id,
            "name": doc_name,
            "shape_count": len(compact_shapes),
            "binding_count": len(compact_bindings),
        },
        "screenshot": {
            "file": shot_name,
            "sha256": shot_sha,
            "bytes": shot_size,
            "width": shot.get("width"),
            "height": shot.get("height"),
            "capture_mode": shot.get("captureMode"),
        },
        "shapes": compact_shapes,
        "bindings": compact_bindings,
    }

    capture_text = json.dumps(capture, ensure_ascii=False, indent=2)
    capture_bytes = (capture_text + "\n").encode("utf-8")
    (run_dir / "capture.json").write_bytes(capture_bytes)

    try:
        validate_capture(capture, run_dir)
    except SystemExit:
        raise
    except Exception as exc:
        fail("ERROR=validation failed: " + str(exc))

    capture_sha = hashlib.sha256(capture_bytes).hexdigest()

    manifest = {
        "schema_version": MANIFEST_VERSION,
        "run_id": run_id,
        "files": {
            "capture.json": {
                "sha256": capture_sha,
                "bytes": len(capture_bytes),
            },
            shot_name: {
                "sha256": shot_sha,
                "bytes": shot_size,
            },
        },
    }
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2)
    manifest_bytes = (manifest_text + "\n").encode("utf-8")
    (run_dir / "manifest.json").write_bytes(manifest_bytes)

    atomic_write(LATEST_CAPTURE, capture_bytes)
    atomic_write(LATEST_MANIFEST, manifest_bytes)

    other_ext = "png" if ext == "jpg" else "jpg"
    stale = BASE_DIR / ("latest_screenshot." + other_ext)
    if stale.exists():
        try:
            stale.unlink()
        except OSError:
            pass
    atomic_write(BASE_DIR / ("latest_screenshot." + ext), shot_data)

    summary = {
        "capture_ok": True,
        "run_id": run_id,
        "doc_id": doc_id,
        "doc_name": doc_name,
        "shape_count": len(compact_shapes),
        "binding_count": len(compact_bindings),
        "screenshot": str(shot_dst),
        "screenshot_bytes": shot_size,
        "screenshot_sha256": shot_sha,
        "capture_json": str(run_dir / "capture.json"),
        "manifest_json": str(run_dir / "manifest.json"),
        "latest_capture": str(LATEST_CAPTURE),
        "latest_screenshot": str(BASE_DIR / ("latest_screenshot." + ext)),
    }

    if json_mode:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print("CAPTURE_OK=yes")
        print("RUN_ID=" + run_id)
        print("DOC_ID=" + str(doc_id))
        print("DOC_NAME=" + str(doc_name))
        print("SHAPE_COUNT=" + str(len(compact_shapes)))
        print("BINDING_COUNT=" + str(len(compact_bindings)))
        print("SCREENSHOT=" + str(shot_dst))
        print("SCREENSHOT_BYTES=" + str(shot_size))
        print("SCREENSHOT_SHA256=" + shot_sha)
        print("CAPTURE_JSON=" + str(run_dir / "capture.json"))
        print("MANIFEST_JSON=" + str(run_dir / "manifest.json"))
        print("LATEST_CAPTURE=" + str(LATEST_CAPTURE))
        print("LATEST_SCREENSHOT=" + str(BASE_DIR / ("latest_screenshot." + ext)))

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        fail("ERROR=unexpected: " + str(exc))
