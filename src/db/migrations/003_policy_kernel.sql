CREATE TABLE intervention_templates (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('process_only','content_cue','structure_reveal')),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  definition_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);

CREATE TABLE policy_definitions (
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  condition_json TEXT NOT NULL CHECK (json_valid(condition_json)),
  exclusions_json TEXT NOT NULL CHECK (json_valid(exclusions_json)),
  priority INTEGER NOT NULL,
  severity INTEGER NOT NULL,
  cooldown_ms INTEGER,
  intervention_template_id TEXT NOT NULL,
  intervention_template_version INTEGER NOT NULL,
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  definition_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','experimental','disabled','retired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, version),
  FOREIGN KEY (intervention_template_id, intervention_template_version)
    REFERENCES intervention_templates(template_id, version)
);

CREATE TABLE policy_bundles (
  bundle_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (bundle_id, version)
);

CREATE TABLE policy_bundle_members (
  bundle_id TEXT NOT NULL,
  bundle_version INTEGER NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, bundle_version, policy_id),
  FOREIGN KEY (bundle_id, bundle_version)
    REFERENCES policy_bundles(bundle_id, version),
  FOREIGN KEY (policy_id, policy_version)
    REFERENCES policy_definitions(policy_id, version)
);

CREATE TABLE policy_activations (
  activation_id TEXT PRIMARY KEY,
  study_session_id TEXT NOT NULL UNIQUE REFERENCES study_sessions(id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  bundle_version INTEGER NOT NULL,
  activated_at TEXT NOT NULL,
  activated_by_event_id TEXT REFERENCES study_events(event_id),
  FOREIGN KEY (bundle_id, bundle_version)
    REFERENCES policy_bundles(bundle_id, version)
);

CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_session_id TEXT REFERENCES study_sessions(id) ON DELETE CASCADE,
  target_id TEXT,
  observation_type TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('direct','self_report','inferred')),
  observation_coverage TEXT NOT NULL CHECK (observation_coverage IN ('complete','partial','unknown')),
  observed_at TEXT NOT NULL,
  source_event_id TEXT REFERENCES study_events(event_id)
);

CREATE INDEX idx_observations_target_type_time
  ON observations(target_id, observation_type, observed_at DESC)
  WHERE target_id IS NOT NULL;

CREATE TABLE policy_detections (
  detection_id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES policy_activations(activation_id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT,
  evaluated_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('matched','not_matched','uncertain')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  explanation_trace_json TEXT NOT NULL CHECK (json_valid(explanation_trace_json)),
  triggering_event_id TEXT REFERENCES study_events(event_id),
  FOREIGN KEY (policy_id, policy_version)
    REFERENCES policy_definitions(policy_id, version)
);

CREATE INDEX idx_policy_detections_target_time
  ON policy_detections(target_id, evaluated_at DESC)
  WHERE target_id IS NOT NULL;

CREATE TABLE policy_interventions (
  intervention_id TEXT PRIMARY KEY,
  detection_id TEXT NOT NULL REFERENCES policy_detections(detection_id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  selected_at TEXT NOT NULL,
  budget_cost INTEGER NOT NULL DEFAULT 1 CHECK (budget_cost >= 0),
  status TEXT NOT NULL CHECK (status IN ('proposed','shown','dismissed','completed','suppressed')),
  resolution_trace_json TEXT NOT NULL CHECK (json_valid(resolution_trace_json)),
  FOREIGN KEY (template_id, template_version)
    REFERENCES intervention_templates(template_id, version)
);

CREATE INDEX idx_policy_interventions_detection
  ON policy_interventions(detection_id, selected_at DESC);
