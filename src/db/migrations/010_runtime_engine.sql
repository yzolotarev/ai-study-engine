-- Runtime engine tables for the LIVE study workflow (Capture → Transcription → Runtime).
-- Adds: canvas_artifacts, protocol_evidence, target_evidence_state, next_action_decisions,
-- and links a goal contract to a study session.

-- Link the formal goal contract to the session that owns it.
ALTER TABLE study_sessions ADD COLUMN contract_id TEXT REFERENCES goal_contracts(contract_id);

CREATE TABLE canvas_artifacts (
  run_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  capture_json TEXT NOT NULL,
  screenshot_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  transcription_json TEXT,
  canonical_flag INTEGER NOT NULL DEFAULT 0,
  learner_owned_flag INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'transcribed' CHECK (status IN ('pending', 'transcribed', 'confirmed', 'rejected')),
  confirmed_json TEXT,
  confirmation_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_canvas_artifacts_session ON canvas_artifacts(study_session_id);

CREATE TABLE protocol_evidence (
  id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  evidence_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  valid_until TEXT
);
CREATE INDEX idx_protocol_evidence_session ON protocol_evidence(study_session_id);
CREATE INDEX idx_protocol_evidence_token ON protocol_evidence(evidence_token);

CREATE TABLE target_evidence_state (
  target_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  ownership_status TEXT NOT NULL DEFAULT 'unverified' CHECK (ownership_status IN ('unverified', 'provisional_owned', 'verified_owned')),
  readiness TEXT NOT NULL DEFAULT 'insufficient' CHECK (readiness IN ('insufficient', 'provisional', 'stable')),
  review_due_at TEXT,
  last_review_at TEXT,
  last_attempt_independent INTEGER NOT NULL DEFAULT 0,
  last_attempt_contaminated INTEGER NOT NULL DEFAULT 0,
  last_answer_visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_target_evidence_state_session ON target_evidence_state(study_session_id);

CREATE TABLE next_action_decisions (
  decision_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  context_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_next_action_decisions_session ON next_action_decisions(study_session_id);
