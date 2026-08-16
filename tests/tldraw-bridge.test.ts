import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCaptureCommand, buildTranscribeCommand, loadLocalConfig, runCaptureThenTranscribe, type LocalConfig } from "../src/adapters/tldraw-bridge.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "tldraw-bridge-"));
}

test("loadLocalConfig returns sensible defaults when no config file exists", () => {
  const cfg = loadLocalConfig(tmp());
  // Default points at the in-repo optional integration dir, not a developer
  // machine path. ASE_TRANSCRIBER_DIR can override it.
  assert.equal(cfg.captureCoreDir, join(process.cwd(), "integrations", "tldraw"));
  assert.equal(cfg.transcribeDir, join(process.cwd(), "integrations", "tldraw"));
  assert.deepEqual(cfg.captureCmd, ["python3", "capture.py"]);
  assert.deepEqual(cfg.transcribeCmd, ["python3", "transcribe.py"]);
  assert.equal(cfg.model, "ggml-org/gemma-4-E2B-it-GGUF:Q4_0");
});

test("loadLocalConfig honors ASE_TRANSCRIBER_DIR override", () => {
  const dir = tmp();
  const prev = process.env.ASE_TRANSCRIBER_DIR;
  process.env.ASE_TRANSCRIBER_DIR = "/custom/transcriber";
  try {
    const cfg = loadLocalConfig(dir);
    assert.equal(cfg.captureCoreDir, "/custom/transcriber");
    assert.equal(cfg.transcribeDir, "/custom/transcriber");
  } finally {
    if (prev === undefined) delete process.env.ASE_TRANSCRIBER_DIR;
    else process.env.ASE_TRANSCRIBER_DIR = prev;
  }
});

test("loadLocalConfig parses a custom config.local.json", () => {
  const dir = tmp();
  const cfgDir = join(dir, ".study-engine");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, "config.local.json"),
    JSON.stringify({ captureCoreDir: "/x", transcribeDir: "/y", model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0" }),
  );
  const cfg = loadLocalConfig(dir);
  assert.equal(cfg.captureCoreDir, "/x");
  assert.equal(cfg.transcribeDir, "/y");
  assert.equal(cfg.model, "ggml-org/gemma-4-E2B-it-GGUF:Q4_0");
});

test("buildCaptureCommand / buildTranscribeCommand copy the command arrays", () => {
  const cfg: LocalConfig = {
    captureCoreDir: "/c",
    transcribeDir: "/t",
    captureCmd: ["python3", "capture.py"],
    transcribeCmd: ["python3", "transcribe.py"],
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  };
  assert.notEqual(buildCaptureCommand(cfg), cfg.captureCmd);
  assert.notEqual(buildTranscribeCommand(cfg), cfg.transcribeCmd);
});

test("runCaptureThenTranscribe orchestrates capture + transcription and binds verified sha", () => {
  const dir = tmp();
  const captureDir = join(dir, "cap");
  const transcribeDir = join(dir, "tr");
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(transcribeDir, { recursive: true });

  // Fake capture script: emits RUN_ID + CAPTURE_VERIFIED and writes latest_capture.json.
  const capScript = join(dir, "fake-capture.cjs");
  writeFileSync(capScript, `console.log("RUN_ID=run-cap-1");\nconsole.log("CAPTURE_OK=yes");\n`);
  const trScript = join(dir, "fake-transcribe.cjs");
  writeFileSync(trScript, `console.log("RUN_ID=run-tr-1");\nconsole.log("TRANSCRIBE_OK=yes");\n`);

  writeFileSync(
    join(captureDir, "latest_capture.json"),
    JSON.stringify({ screenshot: { sha256: "deadbeef" }, shapeCount: 1 }),
  );
  writeFileSync(
    join(transcribeDir, "latest_transcription.json"),
    JSON.stringify({ schema_version: "study-canvas-transcription/v1", capture_sha256: "deadbeef" }),
  );

  const cfg: LocalConfig = {
    captureCoreDir: captureDir,
    transcribeDir: transcribeDir,
    captureCmd: ["node", capScript],
    transcribeCmd: ["node", trScript],
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  };

  const result = runCaptureThenTranscribe(cfg);
  assert.equal(result.ok, true);
  assert.equal(result.runId, "run-cap-1");
  assert.equal(result.captureVerified, true);
  assert.equal(result.transcriptionRunId, "run-tr-1");
  assert.equal(result.transcribed, true);
  assert.equal(result.screenshotSha256, "deadbeef");
  assert.equal((result.captureJson as { shapeCount: number }).shapeCount, 1);
});

test("runCaptureThenTranscribe fails closed when capture is not verified", () => {
  const dir = tmp();
  const captureDir = join(dir, "cap");
  const transcribeDir = join(dir, "tr");
  mkdirSync(captureDir, { recursive: true });
  mkdirSync(transcribeDir, { recursive: true });
  const capScript = join(dir, "fake-capture.cjs");
  writeFileSync(capScript, `console.log("RUN_ID=run-cap-2");\nconsole.log("CAPTURE_OK=no");\n`);
  const trScript = join(dir, "fake-transcribe.cjs");
  writeFileSync(trScript, `console.log("TRANSCRIBE_OK=yes");\n`);

  const cfg: LocalConfig = {
    captureCoreDir: captureDir,
    transcribeDir: transcribeDir,
    captureCmd: ["node", capScript],
    transcribeCmd: ["node", trScript],
    model: "ggml-org/gemma-4-E2B-it-GGUF:Q4_0",
  };
  const result = runCaptureThenTranscribe(cfg);
  assert.equal(result.ok, false);
  assert.equal(result.error, "capture not verified");
  assert.equal(result.transcribed, undefined);
});
