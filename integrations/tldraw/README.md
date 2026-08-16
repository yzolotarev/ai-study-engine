# tldraw Integration (optional)

Optional bridge between [tldraw](https://tldraw.com) (the learner's local whiteboard)
and AI Study Engine.

## What this is

- `capture.py` — **Capture Core**. Reads the live tldraw canvas through the tldraw
  Local Canvas API and writes a *canonical learner artifact* (`latest_capture.json`).
  This is the learner-owned record of what they drew. It is the source of truth.
- `transcribe.py` — **optional AI observer**. Sends the canvas screenshot to a
  local vision model (e.g. Gemma 4 E2B via llama.cpp / gemini-web2api) and produces
  `latest_transcription.json`. This is an *AI observation*, **not** learner evidence
  and **not** canonical. It can never modify the capture artifact.
- `capture_schema_v1.json` / `transcription_schema_v1.json` — schemas.
- `transcription_prompt_v1.md` — the prompt used by the transcription adapter.
- `README_CAPTURE_CORE.md` / `README_TRANSCRIPTION.md` — upstream docs.

## Separating fact from observation

```
tldraw canvas
     │
     ▼
Capture Core  ──►  latest_capture.json        (CANONICAL, learner-owned "fact")
     │
     ▼
Transcription ──►  latest_transcription.json  (AI OBSERVATION, non-canonical)
```

The Study Engine consumes the capture as evidence. The transcription is kept
separate and may be used for suggestions only.

## Install the external pieces yourself

This directory ships the scripts only. You must install separately:

- tldraw Offline with the **Local Canvas API** enabled (not vendored — too large
  and binary).
- A local vision backend: `llama.cpp` app/CLI + a Gemma 4 E2B GGUF model
  (not vendored — license/size).

## Configure

Copy the local template and edit the paths:

```bash
cp .study-engine/config.example.json .study-engine/config.local.json
```

Point `captureCoreDir` / `transcribeDir` at this directory (or wherever you keep
the scripts). You may also set `ASE_TRANSCRIBER_DIR` to override the default.

## Run

```bash
npm run study -- canvas <sessionId>
npm run study -- confirm-canvas <sessionId> '[<observationId>]' [note]
```

This invokes `capture.py` then `transcribe.py` via the configured commands.
