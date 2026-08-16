# tldraw Capture Core v1

## Purpose

Capture Core сохраняет то, что пользователь реально создал в tldraw.

Он НЕ пытается понимать смысл рисунка.

## Core principle

  learner artifact != AI interpretation

Capture Core содержит только фактический capture layer.

## Architecture

  tldraw Local Canvas API
      ↓
  focused document
      ↓
  screenshot + compact metadata
      ↓
  immutable run
      ↓
  hashes + manifest
      ↓
  latest canonical capture

## Run

  cd /path/to/ai-study-engine/integrations/tldraw
  python3 capture.py

## Machine-readable summary

  python3 capture.py --json

## Outputs

  runs/<run-id>/
    screenshot.jpg|png
    capture.json
    manifest.json

  latest_capture.json
  latest_manifest.json
  latest_screenshot.jpg|png

## What is stored

  document id/name
  timestamp
  screenshot
  screenshot hash
  compact shape metadata
  compact bindings

## What is intentionally NOT stored/interpreted

  no OCR
  no AI
  no Gemma
  no Web2API vision
  no decoded draw paths
  no semantic relations
  no inferred groups
  no inferred meaning

## Raw drawing

Screenshot является canonical visual learner artifact.

Compact metadata является вспомогательной структурой,
которую tldraw уже знает сам.

## Failure policy

Capture Core fails closed on:

  tldraw API unavailable
  missing focused document
  empty document
  invalid screenshot
  malformed API response
  validation failure
  hash mismatch

latest_* никогда не обновляются невалидным run.

## Downstream contract

Любой будущий transcription/vision слой должен читать:

  latest_capture.json
  latest_screenshot.*

Но его результат НИКОГДА не должен переписывать
canonical Capture Core artifacts.
