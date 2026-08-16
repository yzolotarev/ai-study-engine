# tldraw Visual Transcription — AI-derived observation layer (Phase 0)

> **NON-CANONICAL.** This layer reads the **canonical Capture Core** artifact
> (`latest_capture.json`) and produces an AI-derived, non-learner-owned
> observation of the tldraw screenshot. It can never modify `latest_capture.json`,
> never create semantic relations, never close gaps, never raise mastery.

## Single backend

- Vision model: **Gemma 4 E2B Q4_0** (`ggml-org/gemma-4-E2B-it-GGUF:Q4_0`)
- Invocation: `llama cli -hf <model> --image <jpg> -p <prompt> --single-turn
  -rea off --reasoning-budget 0 --no-display-prompt -ngl 99 -c 4096 --temp 0 -n 1024`
- **Exactly one inference** per run. No fallback, no retry. If Gemma fails,
  the tool fails closed (exit ≠ 0, no `latest_transcription.json` update).

## Files

| File | Role |
|------|------|
| `transcription_prompt_v1.md` | Boundary prompt: literal observation only |
| `transcription_schema_v1.json` | JSON Schema `study-canvas-transcription/v1` |
| `transcribe.py` | Single-shot adapter (child_process via stdlib `subprocess`) |

## Contract

- Reads `latest_capture.json` (or `--capture <path>`).
- Verifies the screenshot SHA256 equals `screenshot.sha256` in the capture.
- Runs one Gemma inference with the prompt + screenshot.
- Extracts the **first** JSON with `schema_version == study-canvas-transcription/v1`.
- Validates: all required fields; `capture_sha256` matches; every
  `from_visual_ref`/`to_visual_ref`/`near_visual_ref` points to an existing
  observation id or `null`.
- Writes `derived-runs/<timestamp_random>/transcription.json` + raw stdout/stderr.
- Atomically updates `latest_transcription.json` only on full success.

## Run

```bash
python3 transcribe.py
python3 transcribe.py --capture /path/to/capture.json
```

## Output flags

- `TRANSCRIBE_OK=yes` / `TRANSCRIBE_OK=no`
- `RUN_ID=...`, `TRANSCRIPTION_PATH=...`, `LATEST_TRANSCRIPTION=...`

On failure: `TRANSCRIBE_OK=no` on stderr, non-zero exit, **no** update of
`latest_transcription.json`.
