CREATE TABLE goal_contracts (
  contract_id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  target_task TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  allowed_hints_json TEXT CHECK (allowed_hints_json IS NULL OR json_valid(allowed_hints_json)),
  retention_days INTEGER,
  learner_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX idx_goal_contracts_learner ON goal_contracts(learner_id);