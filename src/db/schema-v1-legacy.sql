PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  locale TEXT NOT NULL,
  timezone TEXT NOT NULL,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  observable_outcome TEXT NOT NULL,
  target_task TEXT NOT NULL,
  assessment_format TEXT NOT NULL,
  deadline TEXT,
  stakes TEXT NOT NULL CHECK (stakes IN ('low','normal','high','competitive')),
  target_bloom INTEGER NOT NULL CHECK (target_bloom BETWEEN 1 AND 6),
  target_solo TEXT NOT NULL,
  status TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  pi_session_id TEXT,
  attempt_branch_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0,
  restart_point_json TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_units (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  learner_description TEXT,
  pacer_json TEXT NOT NULL,
  layer TEXT NOT NULL,
  criticality TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_relations (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  from_unit_id TEXT NOT NULL REFERENCES knowledge_units(id) ON DELETE CASCADE,
  to_unit_id TEXT NOT NULL REFERENCES knowledge_units(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  learner_statement TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_attempt_ids_json TEXT NOT NULL DEFAULT '[]',
  source_claim_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  unit_ids_json TEXT NOT NULL,
  mode TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  diagnostic_excerpt TEXT,
  raw_response_artifact_id TEXT,
  input_modality TEXT NOT NULL CHECK (input_modality IN ('text','voice_transcript','code','image','mixed')),
  assistance_kind TEXT NOT NULL CHECK (assistance_kind IN ('none','hint','partial_solution','full_answer')),
  answer_visible_before_attempt INTEGER NOT NULL DEFAULT 0,
  help_level_used INTEGER NOT NULL DEFAULT 0 CHECK (help_level_used BETWEEN 0 AND 6),
  self_report_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS assessment_evidence (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  evaluator TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('correct','partial','gap','uncertain','disputed')),
  dimensions_json TEXT NOT NULL,
  critical_errors_json TEXT NOT NULL DEFAULT '[]',
  unsupported_claims_json TEXT NOT NULL DEFAULT '[]',
  evaluator_notes TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gaps (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  unit_ids_json TEXT NOT NULL,
  question TEXT NOT NULL,
  classification TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL,
  detected_by_evidence_id TEXT NOT NULL,
  remediation_attempt_ids_json TEXT NOT NULL DEFAULT '[]',
  provisional_closed_by_evidence_id TEXT,
  verified_by_evidence_id TEXT,
  next_check_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  title TEXT,
  author TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  authority_class TEXT NOT NULL,
  content_hash TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  locator TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  due_window_start TEXT NOT NULL,
  due_window_end TEXT NOT NULL,
  stage INTEGER NOT NULL DEFAULT 0,
  last_evidence_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS load_samples (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  self_focus INTEGER,
  self_effort INTEGER,
  response_latency_ms INTEGER,
  error_streak INTEGER NOT NULL,
  help_level INTEGER NOT NULL,
  slowdown_ratio REAL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_session_id TEXT,
  attempt_branch_id TEXT NOT NULL,
  parent_event_id TEXT,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_objective ON study_sessions(user_id, objective_id);
CREATE INDEX IF NOT EXISTS idx_units_objective ON knowledge_units(objective_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_gaps_objective_state ON gaps(objective_id, state);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON review_items(user_id, status, due_window_start);
CREATE INDEX IF NOT EXISTS idx_events_branch_sequence ON domain_events(attempt_branch_id, sequence);
