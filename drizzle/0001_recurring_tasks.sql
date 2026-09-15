CREATE TABLE recurring_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  effort_hours REAL NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  active INTEGER NOT NULL DEFAULT 1,
  last_created_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE tasks ADD COLUMN recurring_task_id TEXT REFERENCES recurring_tasks(id);
CREATE INDEX idx_recurring_tasks_owner_active ON recurring_tasks(owner_id, active);
CREATE INDEX idx_tasks_recurring_task ON tasks(recurring_task_id);
