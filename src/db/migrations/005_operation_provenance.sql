CREATE TABLE operation_attempts (
  operation_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT,
  operation TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('learner', 'ai', 'source', 'shared')),
  help_level TEXT NOT NULL CHECK (help_level IN (
    'none', 'process_only', 'familiarity', 'content_cue',
    'partial_step', 'structure_reveal', 'direct_answer', 'full_solution'
  )),
  answer_visible INTEGER NOT NULL DEFAULT 0,
  cue_varied INTEGER NOT NULL DEFAULT 0,
  attempt_independent INTEGER NOT NULL DEFAULT 0,
  contamination_scope TEXT CHECK (contamination_scope IN (
    'target', 'relation', 'group', 'priority', 'explanation', 'question'
  )),
  evidence_id TEXT,
  confidence TEXT NOT NULL DEFAULT 'uncertain' CHECK (confidence IN (
    'high', 'medium', 'low', 'uncertain'
  )),
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN (
    'clean', 'familiarity_only', 'assisted', 'contaminated',
    'provisional_owned', 'verified_owned', 'disputed', 'unknown'
  )),
  artifact_json TEXT CHECK (artifact_json IS NULL OR json_valid(artifact_json)),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  causation_event_id TEXT
);

CREATE INDEX idx_operation_attempts_session ON operation_attempts(study_session_id);
CREATE INDEX idx_operation_attempts_learner ON operation_attempts(learner_id);
CREATE INDEX idx_operation_attempts_target ON operation_attempts(target_id);
CREATE INDEX idx_operation_attempts_operation ON operation_attempts(operation);

CREATE TABLE contamination_records (
  record_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_session_id TEXT REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN (
    'target', 'relation', 'group', 'priority', 'explanation', 'question'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'clean', 'familiarity_only', 'assisted', 'contaminated',
    'provisional_owned', 'verified_owned', 'disputed', 'unknown'
  )),
  contaminating_help_level TEXT NOT NULL CHECK (contaminating_help_level IN (
    'none', 'process_only', 'familiarity', 'content_cue',
    'partial_step', 'structure_reveal', 'direct_answer', 'full_solution'
  )),
  contaminating_operation_id TEXT REFERENCES operation_attempts(operation_id),
  contaminating_artifact_id TEXT,
  opened_at TEXT NOT NULL,
  opened_by_event_id TEXT,
  closed_at TEXT,
  closure_method TEXT CHECK (closure_method IN (
    'independent_reconstruction', 'varied_application',
    'delayed_retrieval', 'disputed', 'reopened'
  )),
  closure_evidence_id TEXT
);

CREATE INDEX idx_contamination_records_learner ON contamination_records(learner_id);
CREATE INDEX idx_contamination_records_target ON contamination_records(target_id);
CREATE INDEX idx_contamination_records_status ON contamination_records(status);

CREATE TABLE contamination_closures (
  closure_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES contamination_records(record_id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  method TEXT CHECK (method IN (
    'independent_reconstruction', 'varied_application',
    'delayed_retrieval', 'disputed', 'reopened'
  )),
  evidence_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_contamination_closures_record ON contamination_closures(record_id);