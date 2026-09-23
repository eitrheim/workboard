create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  project text not null,
  project_id uuid references projects(id),
  deadline date,
  owner_name text not null default 'Unassigned',
  effort_hours numeric(6,2) not null check (effort_hours > 0),
  status text not null default 'active',
  blocker text,
  notes text not null default '',
  notes_ai boolean not null default false,
  parent_task_id uuid references tasks(id),
  recurring_task_id uuid,
  source_kind text,
  source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  project text not null,
  owner_name text not null,
  effort_hours numeric(6,2) not null check (effort_hours > 0),
  weekday integer not null check (weekday between 0 and 6),
  active boolean not null default true,
  last_created_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists completed_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  task_id uuid references tasks(id),
  title text not null,
  project text not null,
  completed_at timestamptz not null default now(),
  effort_hours numeric(6,2) not null check (effort_hours > 0),
  points integer not null check (points in (10, 20, 40))
);

create table if not exists score_events (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  event_date date not null default current_date,
  amount integer not null,
  cause text not null,
  task_id uuid references tasks(id),
  created_at timestamptz not null default now()
);

create table if not exists source_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  source text not null,
  source_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'unreviewed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_exceptions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  source text not null,
  message text not null,
  status text not null default 'open',
  logged_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  milestone_date date not null,
  project text not null default 'Unassigned',
  project_id uuid references projects(id),
  type text not null default 'Milestone' check (type in ('Milestone', 'Deadline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tasks add column if not exists notes text not null default '';
alter table tasks add column if not exists notes_ai boolean not null default false;
alter table tasks add column if not exists parent_task_id uuid references tasks(id);
alter table tasks add column if not exists project_id uuid references projects(id);
alter table milestones add column if not exists project_id uuid references projects(id);
alter table tasks alter column owner_name set default 'Unassigned';
alter table completed_tasks drop constraint if exists completed_tasks_points_check;
alter table completed_tasks add constraint completed_tasks_points_check check (points in (0, 10, 20, 40));

create index if not exists tasks_owner_status_idx on tasks(owner_id, status);
create unique index if not exists tasks_owner_source_idx on tasks(owner_id, source_kind, source_id) where source_kind is not null and source_id is not null;
create index if not exists score_events_owner_date_idx on score_events(owner_id, event_date);
create unique index if not exists source_items_owner_source_id_idx on source_items(owner_id, source, source_id) where source_id is not null;
create index if not exists projects_owner_status_idx on projects(owner_id, status);
create index if not exists milestones_owner_date_idx on milestones(owner_id, milestone_date);
create index if not exists tasks_project_id_idx on tasks(project_id);
create index if not exists milestones_project_id_idx on milestones(project_id);

update tasks t
set project_id = p.id
from projects p
where t.project_id is null and t.owner_id = p.owner_id and t.project = p.name;

update milestones m
set project_id = p.id
from projects p
where m.project_id is null and m.owner_id = p.owner_id and m.project = p.name;
