CREATE TABLE policy_parameters (
  parameter_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  definition_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','experimental','disabled','retired')),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parameter_id, version)
);
