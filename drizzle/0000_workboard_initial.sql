CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, name)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  deadline TEXT,
  owner_name TEXT NOT NULL DEFAULT 'Unassigned',
  effort_hours REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  blocker TEXT,
  notes TEXT NOT NULL DEFAULT '',
  notes_ai INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT,
  source_kind TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, source_kind, source_id)
);
CREATE TABLE completed_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  task_id TEXT,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  effort_hours REAL NOT NULL,
  points INTEGER NOT NULL
);
CREATE TABLE score_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  cause TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unreviewed',
  file_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE source_exceptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  logged_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  milestone_date TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT 'Unassigned',
  type TEXT NOT NULL DEFAULT 'Milestone',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_owner_status ON tasks(owner_id, status);
CREATE INDEX idx_score_events_owner_date ON score_events(owner_id, event_date);
CREATE INDEX idx_projects_owner_status ON projects(owner_id, status);
CREATE INDEX idx_milestones_owner_date ON milestones(owner_id, milestone_date);
