import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LocalConfig {
  captureCoreDir: string;
  transcribeDir: string;
  captureCmd: string[];
  transcribeCmd: string[];
  model: string;
}

export const DEFAULT_MODEL = "ggml-org/gemma-4-E2B-it-GGUF:Q4_0";

// Neutral placeholder used only when neither a local config file nor the
// ASE_TRANSCRIBER_DIR environment variable is present. It points at the
// in-repo optional integration directory so first-run errors are actionable
// rather than referencing a specific developer's machine.
const DEFAULT_TRANSCRIBER_DIR = join(
  process.cwd(),
  "integrations",
  "tldraw",
);

export function loadLocalConfig(cwd?: string): LocalConfig {
  const base = cwd ?? process.cwd();
  const path = join(base, ".study-engine", "config.local.json");
  const envDir = process.env.ASE_TRANSCRIBER_DIR;
  const fallbackDir =
    envDir && envDir.length ? envDir : DEFAULT_TRANSCRIBER_DIR;
  if (!existsSync(path)) {
    return {
      captureCoreDir: fallbackDir,
      transcribeDir: fallbackDir,
      captureCmd: ["python3", "capture.py"],
      transcribeCmd: ["python3", "transcribe.py"],
      model: DEFAULT_MODEL,
    };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalConfig>;
  return {
    captureCoreDir: raw.captureCoreDir ?? fallbackDir,
    transcribeDir: raw.transcribeDir ?? raw.captureCoreDir ?? fallbackDir,
    captureCmd: raw.captureCmd && raw.captureCmd.length ? raw.captureCmd : ["python3", "capture.py"],
    transcribeCmd: raw.transcribeCmd && raw.transcribeCmd.length ? raw.transcribeCmd : ["python3", "transcribe.py"],
    model: raw.model ?? DEFAULT_MODEL,
  };
}

export function buildCaptureCommand(cfg: LocalConfig): string[] {
  return [...cfg.captureCmd];
}

export function buildTranscribeCommand(cfg: LocalConfig): string[] {
  return [...cfg.transcribeCmd];
}

export interface CaptureThenTranscribeResult {
  ok: boolean;
  runId?: string;
  captureVerified?: boolean;
  transcriptionRunId?: string;
  transcribed?: boolean;
  captureJson?: unknown;
  transcriptionJson?: unknown;
  screenshotSha256?: string;
  error?: string;
}

/**
 * Runs Capture Core then the Gemma transcription adapter.
 * The transcription is NON-canonical and NON-learner-owned; it can never modify
 * the canonical capture artifact. Exactly one capture + one transcription run.
 */
export function runCaptureThenTranscribe(
  cfg: LocalConfig,
  opts?: { timeoutMs?: number },
): CaptureThenTranscribeResult {
  const timeout = opts?.timeoutMs ?? 180_000;
  try {
    const captureBin = cfg.captureCmd[0];
    if (!captureBin) return { ok: false, error: "captureCmd is empty" };
    const capOut = execFileSync(captureBin, cfg.captureCmd.slice(1), {
      cwd: cfg.captureCoreDir,
      encoding: "utf8",
      timeout,
    });
    const runIdMatch = capOut.match(/RUN_ID=([^\s]+)/);
    // The canonical Capture Core emits CAPTURE_OK=yes (never CAPTURE_VERIFIED).
    // Accept either spelling for forward compatibility.
    const verified = /CAPTURE_OK=yes|CAPTURE_VERIFIED=yes/.test(capOut);
    if (!verified) {
      return { ok: false, ...(runIdMatch?.[1] ? { runId: runIdMatch[1] } : {}), error: "capture not verified" };
    }

    const captureJson = JSON.parse(
      readFileSync(join(cfg.captureCoreDir, "latest_capture.json"), "utf8"),
    ) as { screenshot?: { sha256?: string } };
    const sha = captureJson.screenshot?.sha256;

    const transcribeBin = cfg.transcribeCmd[0];
    if (!transcribeBin) return { ok: false, ...(runIdMatch?.[1] ? { runId: runIdMatch[1] } : {}), captureVerified: true, error: "transcribeCmd is empty" };
    const trOut = execFileSync(transcribeBin, cfg.transcribeCmd.slice(1), {
      cwd: cfg.transcribeDir,
      encoding: "utf8",
      timeout,
    });
    const trOk = /TRANSCRIBE_OK=yes/.test(trOut);
    if (!trOk) {
      return { ok: false, ...(runIdMatch?.[1] ? { runId: runIdMatch[1] } : {}), captureVerified: true, error: "transcription failed" };
    }

    const trRunMatch = trOut.match(/RUN_ID=([^\s]+)/);
    const transcriptionJson = JSON.parse(
      readFileSync(join(cfg.transcribeDir, "latest_transcription.json"), "utf8"),
    );

    return {
      ok: true,
      ...(runIdMatch?.[1] ? { runId: runIdMatch[1] } : {}),
      captureVerified: true,
      ...(trRunMatch?.[1] ? { transcriptionRunId: trRunMatch[1] } : {}),
      transcribed: true,
      captureJson,
      transcriptionJson,
      ...(sha ? { screenshotSha256: sha } : {}),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
