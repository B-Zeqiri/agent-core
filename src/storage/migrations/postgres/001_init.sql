CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  tool_name TEXT,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_task ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_agent ON audit_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_time ON audit_events(timestamp);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  metadata_json TEXT,
  pinned_long INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_agent ON memory_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_time ON memory_entries(timestamp);

CREATE TABLE IF NOT EXISTS replay_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  started_at BIGINT NOT NULL,
  completed_at BIGINT,
  duration_ms BIGINT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_replay_events_task ON replay_events(task_id);
CREATE INDEX IF NOT EXISTS idx_replay_events_time ON replay_events(started_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  input TEXT NOT NULL,
  output TEXT,
  raw_output TEXT,
  agent_result_json TEXT,
  status TEXT NOT NULL,
  agent TEXT,
  agent_version TEXT,
  agent_selection_reason TEXT,
  started_at BIGINT NOT NULL,
  completed_at BIGINT,
  duration_ms BIGINT,
  error TEXT,
  error_code TEXT,
  failed_layer TEXT,
  stack_trace TEXT,
  suggestions_json TEXT,
  is_retry INTEGER,
  original_task_id TEXT,
  retry_count INTEGER,
  retries_json TEXT,
  available_agents_json TEXT,
  agent_scores_json TEXT,
  manually_selected INTEGER,
  involved_agents_json TEXT,
  involved_agent_versions_json TEXT,
  conversation_id TEXT,
  messages_json TEXT,
  progress DOUBLE PRECISION,
  tags_json TEXT,
  user_id TEXT,
  generation_json TEXT,
  system_mode TEXT,
  multi_agent_enabled INTEGER,
  worker_id TEXT,
  lease_expires_at BIGINT,
  last_claimed_at BIGINT,
  claim_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent);
CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
CREATE INDEX IF NOT EXISTS idx_tasks_retry ON tasks(is_retry);
CREATE INDEX IF NOT EXISTS idx_tasks_original ON tasks(original_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);

CREATE TABLE IF NOT EXISTS runtime_tasks (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT,
  duration_ms BIGINT,
  progress INTEGER,
  input TEXT NOT NULL,
  output TEXT,
  error TEXT,
  progress_messages_json TEXT,
  generation_json TEXT,
  system_mode TEXT,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_tasks_status ON runtime_tasks(status);
CREATE INDEX IF NOT EXISTS idx_runtime_tasks_started ON runtime_tasks(started_at);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  ts BIGINT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  tool_name TEXT NOT NULL,
  args_json TEXT,
  success INTEGER NOT NULL,
  duration_ms BIGINT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_time ON tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

CREATE TABLE IF NOT EXISTS state_changes (
  id TEXT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_state_changes_time ON state_changes(timestamp);
CREATE INDEX IF NOT EXISTS idx_state_changes_task ON state_changes(task_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_agent ON state_changes(agent_id);
CREATE INDEX IF NOT EXISTS idx_state_changes_type ON state_changes(event_type);
