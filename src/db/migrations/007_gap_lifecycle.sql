CREATE TABLE gap_records (
  gap_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'provisional_closed', 'verified', 'reopened'
  )),
  opened_at TEXT NOT NULL,
  opened_by_evidence_id TEXT,
  closed_at TEXT,
  closure_method TEXT CHECK (closure_method IN (
    'independent_reconstruction', 'varied_application',
    'delayed_retrieval', 'disputed', 'reopened'
  )),
  closure_evidence_id TEXT,
  verified_at TEXT,
  verified_by_evidence_id TEXT
);

CREATE INDEX idx_gap_records_session ON gap_records(study_session_id);
CREATE INDEX idx_gap_records_target ON gap_records(target_id);
CREATE INDEX idx_gap_records_status ON gap_records(status);