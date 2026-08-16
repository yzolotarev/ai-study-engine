CREATE TABLE study_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_session_id TEXT REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT,
  protocol_instance_id TEXT,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_hash TEXT,
  integrity_status TEXT NOT NULL CHECK (integrity_status IN ('verified','legacy_unverified')),
  actor TEXT NOT NULL CHECK (actor IN ('user','engine','ai','human_reviewer')),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  causation_event_id TEXT REFERENCES study_events(event_id),
  correlation_id TEXT,
  legacy_domain_event_id TEXT UNIQUE
);

CREATE INDEX idx_study_events_learner_time
  ON study_events(learner_id, occurred_at DESC, sequence DESC);
CREATE INDEX idx_study_events_target_type_time
  ON study_events(target_id, event_type, occurred_at DESC, sequence DESC)
  WHERE target_id IS NOT NULL;
CREATE INDEX idx_study_events_session_sequence
  ON study_events(study_session_id, sequence)
  WHERE study_session_id IS NOT NULL;
CREATE INDEX idx_study_events_type_sequence
  ON study_events(event_type, sequence);

-- Preserve legacy history. Old rows did not carry a payload hash or distinct
-- occurred/recorded timestamps, so they remain explicitly unverified rather
-- than receiving a fabricated integrity value.
INSERT INTO study_events(
  event_id, learner_id, study_session_id, event_type, schema_version,
  payload_json, payload_hash, integrity_status, actor, provenance_json,
  occurred_at, recorded_at, causation_event_id, correlation_id,
  legacy_domain_event_id
)
SELECT
  id, user_id, study_session_id, event_type, schema_version,
  payload_json, NULL, 'legacy_unverified', actor, provenance_json,
  created_at, created_at, parent_event_id, attempt_branch_id, id
FROM domain_events
ORDER BY sequence;
