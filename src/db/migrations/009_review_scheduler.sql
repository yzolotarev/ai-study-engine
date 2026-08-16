CREATE TABLE review_schedule (
  review_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue', 'cancelled')),
  completed_at TEXT,
  completion_evidence_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_review_schedule_session ON review_schedule(study_session_id);
CREATE INDEX idx_review_schedule_due ON review_schedule(due_at);
CREATE INDEX idx_review_schedule_status ON review_schedule(status);