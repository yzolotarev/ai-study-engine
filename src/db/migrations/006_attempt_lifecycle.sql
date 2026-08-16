DROP TABLE IF EXISTS assessment_evidence;
DROP TABLE IF EXISTS attempts;

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT,
  protocol_node_id TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN (
    'started', 'submitted', 'assessed', 'abandoned'
  )),
  artifact_json TEXT CHECK (artifact_json IS NULL OR json_valid(artifact_json)),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  assessed_at TEXT
);

CREATE INDEX idx_attempts_session ON attempts(study_session_id);
CREATE INDEX idx_attempts_target ON attempts(target_id);
CREATE INDEX idx_attempts_status ON attempts(status);

CREATE TABLE assessment_evidence (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  score REAL,
  confidence REAL,
  notes_json TEXT CHECK (notes_json IS NULL OR json_valid(notes_json)),
  assessed_at TEXT NOT NULL
);

CREATE INDEX idx_assessment_evidence_attempt ON assessment_evidence(attempt_id);