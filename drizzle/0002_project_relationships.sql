-- Preserve the legacy project text during the transition. The nullable IDs are
-- backfilled only when the owner and project name match exactly.
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE milestones ADD COLUMN project_id TEXT REFERENCES projects(id);

UPDATE tasks
SET project_id = (
  SELECT projects.id FROM projects
  WHERE projects.owner_id = tasks.owner_id AND projects.name = tasks.project
)
WHERE project_id IS NULL;

UPDATE milestones
SET project_id = (
  SELECT projects.id FROM projects
  WHERE projects.owner_id = milestones.owner_id AND projects.name = milestones.project
)
WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);
