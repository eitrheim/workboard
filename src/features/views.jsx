import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowsDownUp,
  CalendarBlank,
  Check,
  CheckCircle,
  CaretDown,
  DotsSixVertical,
  FileArrowUp,
  ListChecks,
  PencilSimple,
  Plus,
  Sparkle,
  StackSimple,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import {
  todayKey,
  addDaysToKey,
  deadlineKeyFromLabel,
  registerDraft,
  emptyTaskDraft,
  buildSubtaskDrafts,
  emptySubtaskDraft,
} from "./utils.js";

function NavButton({ item, count, active, onClick, compact = false }) {
  const Icon = item.icon;
  return (
    <button
      className={`nav-button ${active ? "active" : ""} ${compact ? "compact" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={compact ? 21 : 20} weight={active ? "fill" : "regular"} />
      <span>{item.label}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function Overview({ queue, tasks, completed, scoreEvents, milestones, onNavigate }) {
  const dueToday = tasks.filter((task) => task.deadlineKey === todayKey() || task.deadline === "Today").length;
  const scoreDays = getLastSevenScoreDays(completed, scoreEvents);
  const periodScore = scoreDays.reduce((sum, day) => sum + day.value, 0);
  const upcomingMilestones = [...milestones]
    .filter((milestone) => milestone.dateKey && milestone.dateKey >= todayKey())
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    .slice(0, 2);
  const queueDetail =
    queue.length === 0 ? "items to review; you're caught up" : `${queue.length === 1 ? "item" : "items"} to review`;
  return (
    <section className="screen-content overview-screen">
      <div className="overview-intro">
        <p>One place to see what needs your attention and how your week is moving.</p>
      </div>
      <div className="overview-grid">
        <OverviewCard
          icon={Archive}
          label="Review queue"
          value={`${queue.length}`}
          detail={queueDetail}
          tone="queue"
          onClick={() => onNavigate("review")}
        />
        <OverviewCard
          icon={ListChecks}
          label="Work register"
          value={`${dueToday}`}
          detail={`${dueToday === 1 ? "item" : "items"} due today`}
          tone="register"
          onClick={() => onNavigate("register")}
        />
        <OverviewMilestoneCard milestones={upcomingMilestones} onClick={() => onNavigate("milestones")} />
        <button className="overview-card overview-score-card" onClick={() => onNavigate("completed")} type="button">
          <div className="overview-card-top">
            <span className="overview-card-label">
              <CheckCircle size={19} /> Score
            </span>
            <ArrowRight size={20} />
          </div>
          <strong>{periodScore} pts</strong>
          <p>Past 7 days</p>
          <ScoreLineChart points={scoreDays} />
          <div className="score-axis">
            {scoreDays.map((day) => (
              <span key={day.short}>{day.label}</span>
            ))}
          </div>
        </button>
      </div>
    </section>
  );
}

function OverviewCard({ icon: Icon, label, value, detail, secondary, tone, onClick }) {
  return (
    <button className={`overview-card overview-${tone}`} onClick={onClick} type="button">
      <div className="overview-card-top">
        <span className="overview-card-label">
          <Icon size={19} /> {label}
        </span>
        <ArrowRight size={20} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
      {secondary && <small>{secondary}</small>}
    </button>
  );
}

function OverviewMilestoneCard({ milestones, onClick }) {
  return (
    <button className="overview-card overview-milestone-card" onClick={onClick} type="button">
      <div className="overview-card-top">
        <span className="overview-card-label">
          <CalendarBlank size={19} /> Milestones
        </span>
        <ArrowRight size={20} />
      </div>
      <div className="overview-milestone-list">
        {milestones.length ? (
          milestones.map((milestone) => (
            <div className={`overview-milestone-item urgency-${milestoneUrgency(milestone)}`} key={milestone.id}>
              <strong>{milestone.name}</strong>
              <span>{milestoneTimingLabel(milestone)}</span>
            </div>
          ))
        ) : (
          <p className="overview-empty-milestones">No upcoming milestones</p>
        )}
      </div>
    </button>
  );
}

function getLastSevenScoreDays(completed, scoreEvents = []) {
  const history = scoreEvents.length
    ? scoreEvents
    : completed.map((item) => ({ date: item.date, dateKey: item.dateKey, amount: item.points }));
  const today = todayKey();
  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDaysToKey(today, -6 + index);
    const date = new Date(`${dateKey}T12:00:00Z`);
    const short = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
    return {
      short,
      dateKey,
      label: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" }),
      value: history
        .filter((item) => item.dateKey === dateKey)
        .reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0),
    };
  });
}

function ScoreLineChart({ points }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const draw = () => {
      const width = canvas.clientWidth || 360;
      const height = canvas.clientHeight || 116;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const max = Math.max(...points.map((point) => point.value), 10);
      const x = (index) => (points.length === 1 ? width / 2 : 12 + (index / (points.length - 1)) * (width - 24));
      const y = (value) => height - 12 - (value / max) * (height - 24);
      context.strokeStyle = "#dbe8e6";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height - 12);
      context.lineTo(width, height - 12);
      context.stroke();
      context.strokeStyle = "#087B72";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.value));
        else context.lineTo(x(index), y(point.value));
      });
      context.stroke();
      points.forEach((point, index) => {
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(x(index), y(point.value), 4, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#087B72";
        context.beginPath();
        context.arc(x(index), y(point.value), 2.5, 0, Math.PI * 2);
        context.fill();
      });
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [points]);
  return (
    <canvas
      ref={canvasRef}
      className="score-line-chart"
      role="img"
      aria-label="Points earned over the past seven days"
    />
  );
}

function ReviewQueue({ queue, onApprove, onDismiss, onModal }) {
  const [filter, setFilter] = useState("all");
  const filters = [
    { id: "all", label: "All", count: queue.length },
    { id: "draft", label: "Drafts", count: queue.filter((item) => item.type === "draft").length },
    { id: "unclear", label: "Unclear", count: queue.filter((item) => item.type === "unclear").length },
  ];
  const visible = queue.filter((item) => filter === "all" || item.type === filter);
  return (
    <section className="screen-content">
      <div className="tab-row" role="tablist" aria-label="Review queue filters">
        {filters.map((item) => (
          <button
            key={item.id}
            className={`pill-tab ${filter === item.id ? "selected" : ""}`}
            onClick={() => setFilter(item.id)}
            role="tab"
            aria-selected={filter === item.id}
          >
            {item.label} <span>{item.count}</span>
          </button>
        ))}
      </div>
      <div className="queue-list">
        {visible.map((item) => (
          <QueueCard key={item.id} item={item} onApprove={onApprove} onDismiss={onDismiss} onModal={onModal} />
        ))}
        {!visible.length && (
          <EmptyState icon={Archive} title="Nothing needs your review" copy="New drafts will appear here." />
        )}
      </div>
    </section>
  );
}

function QueueCard({ item, onApprove, onDismiss, onModal }) {
  const SourceIcon = item.sourceKind === "file" ? FileArrowUp : Archive;
  const isUnclear = item.type === "unclear";
  return (
    <article className={`queue-card ${isUnclear ? "warning-card" : ""}`}>
      <div className="card-main">
        <div className="source-line">
          <SourceIcon size={23} />
          <span>{item.source}</span>
          {item.badge && <span className={`status-badge ${isUnclear ? "warning" : "success"}`}>{item.badge}</span>}
        </div>
        <h2>{item.title}</h2>
        <p className={isUnclear ? "warning-copy" : "meta-copy"}>{item.detail}</p>
      </div>
      <div className="card-actions">
        {isUnclear ? (
          <>
            <button className="secondary-button" onClick={() => onDismiss(item.id)}>
              <Trash size={17} /> Delete
            </button>
            <button className="primary-button" onClick={() => onModal({ type: "fill", item })}>
              Fill in
            </button>
          </>
        ) : (
          <>
            <button className="secondary-button" onClick={() => onModal({ type: "edit", item })}>
              <PencilSimple size={18} /> Edit
            </button>
            <button className="secondary-button" onClick={() => onDismiss(item.id)}>
              <Trash size={17} /> Delete
            </button>
            <button className="primary-button" onClick={() => onApprove(item)}>
              Approve
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function ProjectView({
  project,
  onProjectChange,
  projects,
  tasks,
  completed,
  milestones,
  onDone,
  onClearBlocker,
  onUpdate,
  onEdit,
  onCreateProject,
  onUpdateProjectStatus,
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectDrag, setProjectDrag] = useState(null);
  const activeProjects = projects.filter((item) => item.status === "active");
  const finishedProjects = projects.filter((item) => item.status === "finished");
  const projectTasks = tasks.filter((task) => task.project === project);
  const projectCompleted = completed.filter((item) => item.project === project);
  const projectMilestones = milestones
    .filter((milestone) => milestone.project === project)
    .map((milestone) => ({
      ...milestone,
      linkedCount: milestone.linkedTaskIds.filter((taskId) => tasks.some((task) => task.id === taskId)).length,
    }))
    .sort((left, right) => (left.dateKey || "9999-12-31").localeCompare(right.dateKey || "9999-12-31"));
  const nextMilestone = projectMilestones.find((milestone) => milestone.dateKey && milestone.dateKey >= todayKey());
  const projectScore = projectCompleted.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const submitProject = (event) => {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    onCreateProject(newProjectName.trim());
    setNewProjectName("");
  };
  const dropProject = (status) => {
    if (projectDrag) onUpdateProjectStatus(projectDrag.name, status);
    setProjectDrag(null);
  };
  return (
    <section className="screen-content project-screen">
      <div className="project-view-header">
        <div className="project-title-block">
          <span className="eyebrow">Single-project view</span>
          <label className="project-switcher">
            <span className="sr-only">Project</span>
            <select
              value={project}
              onChange={(event) => {
                setCompletedOpen(false);
                onProjectChange(event.target.value);
              }}
            >
              {projects.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.status === "finished" ? " · Finished" : ""}
                </option>
              ))}
            </select>
            <CaretDown size={18} />
          </label>
        </div>
        <div className="project-stats" aria-label={`${project} project stats`}>
          <div className="project-stat project-open-stat">
            <span>Open</span>
            <strong>
              <span className="project-stat-value">{projectTasks.length}</span>
              <span className="project-stat-unit">Tasks</span>
            </strong>
          </div>
          <div className="project-stat project-completed-stat">
            <span>Completed</span>
            <strong>
              <span className="project-stat-value">{projectScore}</span>
              <span className="project-stat-unit">Pts</span>
            </strong>
          </div>
          <div className="project-stat project-next-stat">
            <span>Next milestone</span>
            {nextMilestone ? (
              <>
                <strong>{nextMilestone.name}</strong>
                <small>
                  {nextMilestone.date} · {milestoneTimingLabel(nextMilestone)}
                </small>
              </>
            ) : (
              <strong>None scheduled</strong>
            )}
          </div>
        </div>
      </div>
      <section className="project-milestones-section">
        <div className="section-title-row">
          <div>
            <h2>Milestones &amp; deadlines</h2>
            <p className="section-subtitle">Key dates scoped to {project}</p>
          </div>
        </div>
        <div className="project-milestones-strip">
          {projectMilestones.map((milestone) => (
            <article className={`project-milestone-card urgency-${milestoneUrgency(milestone)}`} key={milestone.id}>
              <span className={`project-milestone-dot urgency-${milestoneUrgency(milestone)}`} />
              <div>
                <strong>{milestone.name}</strong>
                <span className="project-milestone-meta">
                  {milestone.date} · {milestone.type} · {milestone.linkedCount} linked{" "}
                  {milestone.linkedCount === 1 ? "task" : "tasks"}
                </span>
                <span className={`project-milestone-timing urgency-${milestoneUrgency(milestone)}`}>
                  {milestoneTimingLabel(milestone)}
                </span>
              </div>
            </article>
          ))}
          {!projectMilestones.length && (
            <p className="project-empty-copy">No milestones or deadlines are linked to this project yet.</p>
          )}
        </div>
      </section>
      <section className="project-open-section">
        <div className="section-title-row">
          <div>
            <h2>Open tasks</h2>
            <p className="section-subtitle">Active work in {project}</p>
          </div>
          <span className="count-badge">{projectTasks.length}</span>
        </div>
        <div className="register-table project-task-table">
          <div className="table-head">
            <span>Task</span>
            <span>Project</span>
            <span>Deadline</span>
            <span>Owner</span>
            <span>Effort</span>
            <span />
          </div>
          {projectTasks.map((task) => (
            <RegisterRow
              key={task.id}
              task={task}
              projectOptions={activeProjectNames(projects)}
              onDone={onDone}
              onClearBlocker={onClearBlocker}
              onUpdate={onUpdate}
              onCreateSubtasks={() => {}}
              hasDraftSubtasks={false}
              onEdit={onEdit}
              showSubtaskAction={false}
            />
          ))}
          {!projectTasks.length && (
            <EmptyState
              icon={ListChecks}
              title="No open tasks"
              copy="New active work for this project will appear here."
            />
          )}
        </div>
      </section>
      <section className="project-completed-section">
        <button
          className="project-completed-toggle"
          onClick={() => setCompletedOpen((value) => !value)}
          aria-expanded={completedOpen}
        >
          <span>
            <h2>Completed</h2>
            <small>
              {projectCompleted.length} completed, {completedOpen ? "tap to collapse" : "tap to view"}
            </small>
          </span>
          <CaretDown size={20} className={completedOpen ? "rotated" : ""} />
        </button>
        {completedOpen && (
          <div className="project-completed-table">
            <div className="project-completed-head">
              <span>Task</span>
              <span>Completed</span>
              <span>Score</span>
            </div>
            {projectCompleted.map((item) => (
              <div className="project-completed-row" key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.date}</span>
                <strong>{item.points ? `+${item.points} pts` : "No points"}</strong>
              </div>
            ))}
            {!projectCompleted.length && <p className="project-empty-copy">No completed tasks for this project yet.</p>}
          </div>
        )}
      </section>
      <section className="project-management-section">
        <div className="section-title-row">
          <div>
            <h2>Projects</h2>
            <p className="section-subtitle">Create projects and move them between active and finished.</p>
          </div>
        </div>
        <form className="new-project-form" onSubmit={submitProject}>
          <input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project name"
            aria-label="New project name"
          />
          <button className="primary-button" type="submit" disabled={!newProjectName.trim()}>
            <Plus size={17} /> Create project
          </button>
        </form>
        <div className="project-status-board">
          <ProjectStatusColumn
            status="active"
            title="Active projects"
            projects={activeProjects}
            onDragStart={setProjectDrag}
            onDrop={dropProject}
            onSelect={onProjectChange}
          />
          <ProjectStatusColumn
            status="finished"
            title="Finished projects"
            projects={finishedProjects}
            onDragStart={setProjectDrag}
            onDrop={dropProject}
            onSelect={onProjectChange}
          />
        </div>
      </section>
    </section>
  );
}

function ProjectStatusColumn({ status, title, projects, onDragStart, onDrop, onSelect }) {
  return (
    <div className="project-status-column" onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(status)}>
      <div className="project-status-heading">
        <h3>{title}</h3>
        <span>{projects.length}</span>
      </div>
      <div className="project-status-list">
        {projects.map((project) => (
          <button
            className="project-status-item"
            type="button"
            draggable
            onDragStart={() => onDragStart(project)}
            onClick={() => onSelect(project.name)}
            key={project.name}
          >
            <span>{project.name}</span>
            <DotsSixVertical size={17} />
          </button>
        ))}
        {!projects.length && <p className="project-status-empty">Drag projects here</p>}
      </div>
    </div>
  );
}

function MilestonesView({ milestones, tasks, projects, onAdd, onUpdate, onDelete }) {
  const [view, setView] = useState("timeline");
  const [showPast, setShowPast] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ name: "", date: "", project: projects[0] || "Unassigned" });
  const nameRef = useRef(null);
  const projectOptions = ["Unassigned", ...projects.filter((project) => project && project !== "Unassigned")];
  const enriched = useMemo(
    () =>
      milestones.map((milestone) => ({
        ...milestone,
        linkedCount: milestone.linkedTaskIds.filter((taskId) => tasks.some((task) => task.id === taskId)).length,
      })),
    [milestones, tasks],
  );
  const [sort, setSort] = useState({ key: "dateKey", direction: "asc" });
  const sorted = useMemo(
    () =>
      [...enriched].sort((left, right) => {
        if (sort.key === "linkedCount")
          return sort.direction === "asc" ? left.linkedCount - right.linkedCount : right.linkedCount - left.linkedCount;
        const leftValue = sort.key === "dateKey" ? left.dateKey || "9999-12-31" : String(left[sort.key] || "");
        const rightValue = sort.key === "dateKey" ? right.dateKey || "9999-12-31" : String(right[sort.key] || "");
        const comparison = leftValue.localeCompare(rightValue);
        return sort.direction === "asc" ? comparison : -comparison;
      }),
    [enriched, sort],
  );
  const [upcoming, past] = useMemo(() => {
    const today = todayKey();
    return [
      sorted.filter((milestone) => !milestone.dateKey || milestone.dateKey.slice(0, 10) >= today),
      sorted.filter((milestone) => milestone.dateKey && milestone.dateKey.slice(0, 10) < today),
    ];
  }, [sorted]);
  const submit = (event) => {
    event.preventDefault();
    if (!quickAdd.name.trim() || !quickAdd.date) return;
    onAdd(quickAdd);
    setQuickAdd((current) => ({ ...current, name: "", date: "" }));
  };
  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  const renderItems = (items, emptyTitle, emptyCopy) =>
    view === "timeline" ? (
      <MilestoneTimeline
        milestones={items}
        projects={projectOptions}
        onUpdate={onUpdate}
        onDelete={onDelete}
        emptyTitle={emptyTitle}
        emptyCopy={emptyCopy}
      />
    ) : (
      <MilestoneList
        milestones={items}
        projects={projectOptions}
        sort={sort}
        onSort={toggleSort}
        onUpdate={onUpdate}
        onDelete={onDelete}
        emptyTitle={emptyTitle}
        emptyCopy={emptyCopy}
      />
    );
  return (
    <section className="screen-content milestones-screen">
      <div className="milestones-toolbar">
        <div className="view-toggle" role="tablist" aria-label="Milestones view">
          <button
            className={view === "timeline" ? "selected" : ""}
            onClick={() => setView("timeline")}
            role="tab"
            aria-selected={view === "timeline"}
          >
            Timeline
          </button>
          <button
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
            role="tab"
            aria-selected={view === "list"}
          >
            List
          </button>
        </div>
        <button className="primary-button milestone-add-button" onClick={() => nameRef.current?.focus()}>
          <Plus size={18} weight="bold" /> Add milestone
        </button>
      </div>
      <form className="milestone-quick-add" onSubmit={submit}>
        <div className="quick-add-label">
          <Plus size={17} />
          <span>Quick add</span>
        </div>
        <input
          ref={nameRef}
          value={quickAdd.name}
          onChange={(event) => setQuickAdd((current) => ({ ...current, name: event.target.value }))}
          placeholder="Milestone or deadline name"
          aria-label="Milestone or deadline name"
        />
        <input
          type="date"
          value={quickAdd.date}
          onChange={(event) => setQuickAdd((current) => ({ ...current, date: event.target.value }))}
          aria-label="Date"
        />
        <label className="quick-project-select">
          <span className="sr-only">Project</span>
          <select
            value={quickAdd.project}
            onChange={(event) => setQuickAdd((current) => ({ ...current, project: event.target.value }))}
          >
            {projectOptions.map((project) => (
              <option key={project}>{project}</option>
            ))}
          </select>
          <CaretDown size={16} />
        </label>
        <button className="secondary-button" type="submit" disabled={!quickAdd.name.trim() || !quickAdd.date}>
          Add
        </button>
      </form>
      {renderItems(upcoming, "No upcoming milestones or deadlines", "Add one above to start planning ahead.")}
      {past.length > 0 && (
        <section className="past-milestones">
          <button
            className="past-milestones-toggle"
            type="button"
            onClick={() => setShowPast((current) => !current)}
            aria-expanded={showPast}
          >
            <span>Past events</span>
            <span className="past-milestones-count">{past.length}</span>
            <CaretDown className={showPast ? "expanded" : ""} size={18} />
          </button>
          {showPast && <div className="past-milestones-content">{renderItems(past, "", "")}</div>}
        </section>
      )}
    </section>
  );
}

function MilestoneTimeline({
  milestones,
  projects,
  onUpdate,
  onDelete,
  emptyTitle = "No milestones yet",
  emptyCopy = "Add one above to start your timeline.",
}) {
  return (
    <div className="milestone-timeline">
      {milestones.map((milestone) => (
        <MilestoneTimelineEntry
          key={milestone.id}
          milestone={milestone}
          projects={projects}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
      {!milestones.length && <EmptyState icon={CalendarBlank} title={emptyTitle} copy={emptyCopy} />}
    </div>
  );
}

function MilestoneTimelineEntry({ milestone, projects, onUpdate, onDelete }) {
  return (
    <article className={`milestone-entry urgency-${milestoneUrgency(milestone)}`}>
      <span className="milestone-dot" />
      <div className="milestone-date">{milestone.date}</div>
      <MilestoneCard milestone={milestone} projects={projects} onUpdate={onUpdate} onDelete={onDelete} />
    </article>
  );
}

function MilestoneCard({ milestone, projects, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: milestone.name,
    dateKey: milestone.dateKey || "",
    project: milestone.project,
    type: milestone.type,
  });
  useEffect(
    () =>
      setDraft({
        name: milestone.name,
        dateKey: milestone.dateKey || "",
        project: milestone.project,
        type: milestone.type,
      }),
    [milestone],
  );
  const save = () => {
    if (!draft.name.trim()) return;
    onUpdate(milestone.id, draft);
    setEditing(false);
  };
  const remove = () => {
    if (window.confirm(`Delete \"${milestone.name}\"? This cannot be undone.`)) onDelete(milestone.id);
  };
  return (
    <div className="milestone-card">
      {editing ? (
        <div className="milestone-edit-grid">
          <input
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            aria-label="Milestone name"
          />
          <input
            type="date"
            value={draft.dateKey}
            onChange={(event) => setDraft((current) => ({ ...current, dateKey: event.target.value }))}
            aria-label="Milestone date"
          />
          <select
            value={draft.project}
            onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))}
          >
            {projects.map((project) => (
              <option key={project}>{project}</option>
            ))}
          </select>
          <select
            value={draft.type}
            onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
          >
            <option>Milestone</option>
            <option>Deadline</option>
          </select>
          <div className="milestone-edit-actions">
            <button className="text-danger milestone-delete-button" type="button" onClick={remove}>
              <Trash size={16} /> Delete
            </button>
            <div className="milestone-edit-primary-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="milestone-card-top">
            <span className="milestone-type">{milestone.type}</span>
            <button className="text-button milestone-edit-button" onClick={() => setEditing(true)}>
              <PencilSimple size={14} /> Edit
            </button>
          </div>
          <h2>{milestone.name}</h2>
          <div className="milestone-card-meta">
            <span>{milestone.project}</span>
            <span>
              {milestone.linkedCount} linked {milestone.linkedCount === 1 ? "task" : "tasks"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function MilestoneList({
  milestones,
  projects,
  sort,
  onSort,
  onUpdate,
  onDelete,
  emptyTitle = "No milestones yet",
  emptyCopy = "Add one above to start your list.",
}) {
  if (!milestones.length) return <EmptyState icon={CalendarBlank} title={emptyTitle} copy={emptyCopy} />;
  return (
    <div className="milestone-list-wrap">
      <div className="milestone-list" role="table" aria-label="Milestones and deadlines">
        <div className="milestone-list-head" role="row">
          <SortHeader label="Date" sortKey="dateKey" sort={sort} onSort={onSort} />
          <SortHeader label="Name" sortKey="name" sort={sort} onSort={onSort} />
          <SortHeader label="Project" sortKey="project" sort={sort} onSort={onSort} />
          <SortHeader label="Type" sortKey="type" sort={sort} onSort={onSort} />
          <SortHeader label="Linked tasks" sortKey="linkedCount" sort={sort} onSort={onSort} />
          <span />
        </div>
        {milestones.map((milestone) => (
          <MilestoneListRow
            milestone={milestone}
            projects={projects}
            onUpdate={onUpdate}
            onDelete={onDelete}
            key={milestone.id}
          />
        ))}
      </div>
    </div>
  );
}

function MilestoneListRow({ milestone, projects, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: milestone.name,
    dateKey: milestone.dateKey || "",
    project: milestone.project,
    type: milestone.type,
  });
  const save = () => {
    if (!draft.name.trim()) return;
    onUpdate(milestone.id, draft);
    setEditing(false);
  };
  const remove = () => {
    if (window.confirm(`Delete \"${milestone.name}\"? This cannot be undone.`)) onDelete(milestone.id);
  };
  if (editing)
    return (
      <div className="milestone-list-row milestone-list-edit-row">
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          aria-label="Milestone name"
        />
        <input
          type="date"
          value={draft.dateKey}
          onChange={(event) => setDraft((current) => ({ ...current, dateKey: event.target.value }))}
          aria-label="Milestone date"
        />
        <select
          value={draft.project}
          onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))}
        >
          {projects.map((project) => (
            <option key={project}>{project}</option>
          ))}
        </select>
        <select
          value={draft.type}
          onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
        >
          <option>Milestone</option>
          <option>Deadline</option>
        </select>
        <span>{milestone.linkedCount}</span>
        <span className="milestone-row-actions">
          <button className="text-danger" type="button" onClick={remove}>
            <Trash size={15} /> Delete
          </button>
          <button className="text-button" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="text-button" type="button" onClick={save}>
            Save
          </button>
        </span>
      </div>
    );
  return (
    <div className="milestone-list-row">
      <strong>{milestone.date}</strong>
      <span>{milestone.name}</span>
      <span>{milestone.project}</span>
      <span className="milestone-type-cell">{milestone.type}</span>
      <span>{milestone.linkedCount}</span>
      <button className="text-button" onClick={() => setEditing(true)}>
        <PencilSimple size={14} /> Edit
      </button>
    </div>
  );
}

function urgencyLabel(milestone) {
  if (!milestone.linkedCount || !milestone.dateKey) return "quiet";
  const daysAway = Math.round(
    (Date.parse(`${milestone.dateKey}T12:00:00`) - Date.parse(`${todayKey()}T12:00:00`)) / 86400000,
  );
  if (daysAway <= 1) return "urgent";
  if (daysAway <= 7) return "approaching";
  if (daysAway <= 30) return "further";
  return "quiet";
}

function milestoneUrgency(milestone) {
  return urgencyLabel(milestone);
}

function milestoneTimingLabel(milestone) {
  if (!milestone?.dateKey) return "No date set";
  const daysAway = Math.round(
    (Date.parse(`${milestone.dateKey}T12:00:00`) - Date.parse(`${todayKey()}T12:00:00`)) / 86400000,
  );
  if (daysAway < 0) return `${Math.abs(daysAway)} day${Math.abs(daysAway) === 1 ? "" : "s"} overdue`;
  if (daysAway === 0) return "Due today";
  if (daysAway === 1) return "Due tomorrow";
  return `Due in ${daysAway} days`;
}

function formatMilestoneDate(dateKey) {
  if (!dateKey) return "No date";
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function activeProjectNames(projects) {
  return projects.filter((project) => project.status === "active").map((project) => project.name);
}

function WorkRegister({
  tasks,
  projects,
  projectFilter,
  setProjectFilter,
  newTaskRequest,
  onConsumeNewTaskRequest,
  onCreateTask,
  onDone,
  onClearBlocker,
  onUpdate,
  onCreateSubtask,
  onEdit,
}) {
  const activeProjects = activeProjectNames(projects);
  const projectFilters = ["All projects", ...Array.from(new Set(tasks.map((task) => task.project).filter(Boolean)))];
  const [subtaskDrafts, setSubtaskDrafts] = useState({});
  const [newTaskDrafts, setNewTaskDrafts] = useState([]);
  const consumedNewTaskRequest = useRef(0);
  const [sort, setSort] = useState({ key: "deadlineKey", direction: "asc" });
  const [savedFilter, setSavedFilter] = useState("All tasks");
  const registerSummary = useMemo(() => {
    const today = todayKey();
    const dated = tasks.filter((task) => task.deadlineKey);
    return {
      overdue: dated.filter((task) => task.deadlineKey < today).length,
      dueToday: dated.filter((task) => task.deadlineKey === today).length,
      upcoming: dated.filter((task) => task.deadlineKey > today).length,
      effort: tasks.reduce((total, task) => total + Number(task.effortHours || 0), 0),
      dueThisWeek: dated.filter((task) => task.deadlineKey >= today && task.deadlineKey <= addDaysToKey(today, 7))
        .length,
    };
  }, [tasks]);
  const visible = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (projectFilter !== "All projects" && task.project !== projectFilter) return false;
          if (savedFilter === "My tasks") return /^ann$/i.test(String(task.owner || ""));
          if (savedFilter === "Due this week")
            return Boolean(
              task.deadlineKey && task.deadlineKey >= todayKey() && task.deadlineKey <= addDaysToKey(todayKey(), 7),
            );
          if (savedFilter === "Needs details")
            return (
              !task.deadlineKey ||
              !task.owner ||
              /^unassigned$/i.test(task.owner) ||
              Number(task.effortHours || 0) === 0
            );
          return true;
        })
        .sort((left, right) => {
          const leftValue =
            sort.key === "effortHours"
              ? Number(left.effortHours || 0)
              : sort.key === "deadlineKey"
                ? left.deadlineKey || deadlineKeyFromLabel(left.deadline) || "9999-12-31"
                : String(left[sort.key] || "");
          const rightValue =
            sort.key === "effortHours"
              ? Number(right.effortHours || 0)
              : sort.key === "deadlineKey"
                ? right.deadlineKey || deadlineKeyFromLabel(right.deadline) || "9999-12-31"
                : String(right[sort.key] || "");
          const comparison =
            typeof leftValue === "number" && typeof rightValue === "number"
              ? leftValue - rightValue
              : String(leftValue).localeCompare(String(rightValue));
          return sort.direction === "asc" ? comparison : -comparison;
        }),
    [tasks, projectFilter, savedFilter, sort],
  );
  useEffect(() => {
    if (!newTaskRequest || newTaskRequest <= consumedNewTaskRequest.current) return;
    const rowsToAdd = newTaskRequest - consumedNewTaskRequest.current;
    consumedNewTaskRequest.current = newTaskRequest;
    setNewTaskDrafts((current) =>
      Array.from({ length: rowsToAdd }, (_, index) => emptyTaskDraft(current.length + index))
        .reverse()
        .concat(current),
    );
    onConsumeNewTaskRequest();
  }, [newTaskRequest, onConsumeNewTaskRequest]);
  const createSubtasks = (task) =>
    setSubtaskDrafts((current) => ({
      ...current,
      [task.id]: current[task.id]?.length ? current[task.id] : buildSubtaskDrafts(task),
    }));
  const addSubtaskRow = (task) =>
    setSubtaskDrafts((current) => ({
      ...current,
      [task.id]: [...(current[task.id] || []), emptySubtaskDraft(task, (current[task.id] || []).length)],
    }));
  const updateSubtaskDraft = (parentId, draftId, field, value) =>
    setSubtaskDrafts((current) => ({
      ...current,
      [parentId]: (current[parentId] || []).map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              [field]: value,
              ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value, draft.deadlineKey) } : {}),
            }
          : draft,
      ),
    }));
  const updateNewTaskDraft = (draftId, field, value) =>
    setNewTaskDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              [field]: value,
              ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value, draft.deadlineKey) } : {}),
            }
          : draft,
      ),
    );
  const saveSubtask = (parent, draft) => {
    onCreateSubtask(parent, draft);
    setSubtaskDrafts((current) => ({
      ...current,
      [parent.id]: (current[parent.id] || []).filter((item) => item.id !== draft.id),
    }));
  };
  const saveNewTask = (draft) => {
    if (!draft.title.trim() || !draft.project.trim() || !Number(draft.effortHours)) return;
    onCreateTask(draft);
    setNewTaskDrafts((current) => current.filter((item) => item.id !== draft.id));
  };
  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  return (
    <section className="screen-content register-screen">
      <div className="register-summary-grid">
        <RegisterSummaryCard tone="overdue" value={registerSummary.overdue} label="Overdue" />
        <RegisterSummaryCard tone="due" value={registerSummary.dueToday} label="Due today" />
        <RegisterSummaryCard tone="upcoming" value={registerSummary.upcoming} label="Upcoming" />
        <RegisterSummaryCard
          tone="effort"
          value={
            Number.isInteger(registerSummary.effort)
              ? registerSummary.effort
              : registerSummary.effort.toFixed(2).replace(/0$/, "")
          }
          label="Total effort, hrs"
        />
      </div>
      <div className="register-toolbar">
        <label className="project-filter">
          <span className="sr-only">Project</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            {projectFilters.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
          <CaretDown size={17} />
        </label>
        <div className="saved-filter-row" aria-label="Saved work register filters">
          {[
            ["My tasks", "My tasks"],
            ["Due this week", `Due this week · ${registerSummary.dueThisWeek}`],
            ["Needs details", "Needs details"],
          ].map(([filter, label]) => (
            <button
              type="button"
              key={filter}
              className={`filter-pill ${savedFilter === filter ? "selected" : ""}`}
              onClick={() => setSavedFilter((current) => (current === filter ? "All tasks" : filter))}
              aria-pressed={savedFilter === filter}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="register-table">
        <div className="table-head">
          <SortHeader label="Task" sortKey="title" sort={sort} onSort={toggleSort} />
          <SortHeader label="Project" sortKey="project" sort={sort} onSort={toggleSort} />
          <SortHeader label="Deadline" sortKey="deadlineKey" sort={sort} onSort={toggleSort} />
          <SortHeader label="Owner" sortKey="owner" sort={sort} onSort={toggleSort} />
          <SortHeader label="Effort" sortKey="effortHours" sort={sort} onSort={toggleSort} />
          <span />
        </div>
        {newTaskDrafts.map((draft) => (
          <NewTaskRow
            key={draft.id}
            draft={draft}
            projectOptions={activeProjects}
            onChange={(field, value) => updateNewTaskDraft(draft.id, field, value)}
            onSave={() => saveNewTask(draft)}
            onCancel={() => setNewTaskDrafts((current) => current.filter((item) => item.id !== draft.id))}
          />
        ))}
        {visible.map((task) => (
          <Fragment key={task.id}>
            <RegisterRow
              task={task}
              projectOptions={activeProjects}
              onDone={onDone}
              onClearBlocker={onClearBlocker}
              onUpdate={onUpdate}
              onCreateSubtasks={createSubtasks}
              hasDraftSubtasks={Boolean(subtaskDrafts[task.id]?.length)}
              onEdit={onEdit}
            />
            {(subtaskDrafts[task.id] || []).map((draft) => (
              <DraftSubtaskRow
                key={draft.id}
                parent={task}
                draft={draft}
                projectOptions={activeProjects}
                onChange={(field, value) => updateSubtaskDraft(task.id, draft.id, field, value)}
                onSave={() => saveSubtask(task, draft)}
              />
            ))}
            {subtaskDrafts[task.id]?.length > 0 && (
              <div className="subtask-add-row">
                <button className="add-subtask-row-button" onClick={() => addSubtaskRow(task)}>
                  <Plus size={14} /> Add another subtask
                </button>
                <span>Each row is saved independently</span>
              </div>
            )}
          </Fragment>
        ))}
        {!visible.length && !newTaskDrafts.length && (
          <EmptyState
            icon={ListChecks}
            title="No active work matches this filter"
            copy="Try another saved filter or add a task."
          />
        )}
      </div>
    </section>
  );
}

function RegisterSummaryCard({ tone, value, label }) {
  return (
    <div className={`register-summary-card ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function NewTaskRow({ draft, projectOptions, onChange, onSave, onCancel }) {
  const canSave = draft.title.trim() && draft.project.trim() && Number(draft.effortHours) > 0;
  const update = (field, value) => onChange(field, value);
  return (
    <div className="table-row new-task-row">
      <div className="task-cell register-edit-cell">
        <Plus size={18} className="new-task-indicator" />
        <input
          className="inline-input task-input"
          value={draft.title}
          placeholder="Task name"
          onChange={(event) => update("title", event.target.value)}
          aria-label="New task name"
          autoFocus
        />
      </div>
      <label className="register-edit-cell" data-label="Project">
        <span className="sr-only">Project</span>
        <select
          className="inline-input project-inline-select"
          value={draft.project}
          onChange={(event) => update("project", event.target.value)}
        >
          <option value="">Select active project</option>
          {projectOptions.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </label>
      <label className="register-edit-cell" data-label="Deadline">
        <span className="sr-only">Deadline</span>
        <input
          className="inline-input"
          type="date"
          value={draft.deadlineKey || ""}
          onChange={(event) => update("deadline", event.target.value)}
        />
      </label>
      <label
        className={`register-edit-cell ${!draft.owner || /^unassigned$/i.test(draft.owner) ? "unassigned-owner" : ""}`}
        data-label="Owner"
      >
        <span className="sr-only">Owner</span>
        <input
          className="inline-input"
          value={draft.owner}
          placeholder="Owner"
          onChange={(event) => update("owner", event.target.value)}
        />
      </label>
      <label
        className={`register-edit-cell ${Number(draft.effortHours || 0) === 0 ? "zero-effort" : ""}`}
        data-label="Effort"
      >
        <span className="sr-only">Effort</span>
        <input
          className="inline-input effort-input"
          type="number"
          min="0.25"
          step="0.25"
          inputMode="decimal"
          value={draft.effortHours}
          placeholder="Hours"
          onChange={(event) => update("effortHours", event.target.value)}
        />
      </label>
      <div className="register-row-actions">
        <button className="secondary-button cancel-new-task-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="save-row-button" disabled={!canSave} onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function RegisterRow({
  task,
  projectOptions,
  onDone,
  onClearBlocker,
  onUpdate,
  onCreateSubtasks,
  hasDraftSubtasks,
  onEdit,
  showSubtaskAction = true,
}) {
  const [draft, setDraft] = useState(() => registerDraft(task));
  useEffect(() => setDraft(registerDraft(task)), [task]);
  const update = (field, value) =>
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value) } : {}),
    }));
  const changed = ["title", "project", "deadline", "owner", "effortHours"].some(
    (field) => String(draft[field] ?? "") !== String(registerDraft(task)[field] ?? ""),
  );
  const dueToday = Boolean(draft.deadlineKey && draft.deadlineKey <= todayKey());
  const overdue = Boolean(draft.deadlineKey && draft.deadlineKey < todayKey());
  const save = () => onUpdate(task.id, draft);
  const ownerMissing = !draft.owner || /^unassigned$/i.test(draft.owner);
  const effortMissing = Number(draft.effortHours || 0) === 0;
  const deadlineLabel = draft.deadlineKey ? formatMilestoneDate(draft.deadlineKey) : "No deadline";
  return (
    <Fragment>
      <div
        className={`mobile-register-card ${task.status === "blocked" ? "blocked-row" : ""} ${overdue ? "overdue" : ""}`}
      >
        <button
          className="mobile-register-card-content"
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Open details for ${task.title}`}
        >
          <div className="mobile-task-head">
            {dueToday && <Warning size={19} className="red-icon" />}
            {task.status === "blocked" && (
              <span className="blocked-indicator">
                <Warning size={18} />
              </span>
            )}
            <strong>{draft.title}</strong>
            {task.recurring && <span className="recurring-label">Weekly</span>}
          </div>
          <div className="mobile-task-meta">
            <span>{draft.project || "No project"}</span>
            <span
              className={
                dueToday ? "mobile-due-chip due" : !draft.deadlineKey ? "mobile-due-chip missing" : "mobile-due-chip"
              }
            >
              <CalendarBlank size={14} />
              {deadlineLabel}
            </span>
            <span className={ownerMissing ? "mobile-missing-detail" : ""}>
              {ownerMissing ? "Unassigned" : draft.owner}
            </span>
            <span className={effortMissing ? "mobile-missing-detail" : ""}>
              {effortMissing ? "No effort" : `${draft.effortHours} hr${Number(draft.effortHours) === 1 ? "" : "s"}`}
            </span>
          </div>
          {task.blocker && <span className="mobile-blocker-copy">{task.blocker}</span>}
        </button>
        <div className="mobile-register-actions">
          {showSubtaskAction && Number(draft.effortHours) > 1 && (
            <button
              className="subtask-button icon-action-button"
              title={hasDraftSubtasks ? "Regenerate subtasks" : "Create subtasks"}
              aria-label={hasDraftSubtasks ? "Regenerate subtasks" : "Create subtasks"}
              onClick={() => onCreateSubtasks({ ...task, ...draft })}
            >
              <Sparkle size={16} />
            </button>
          )}
          {task.status === "blocked" ? (
            <button className="mobile-clear-blocker" type="button" onClick={() => onClearBlocker(task)}>
              Clear blocker
            </button>
          ) : (
            <button
              className="icon-action-button done-action-button"
              type="button"
              title="Mark done"
              aria-label={`Mark ${task.title} done`}
              onClick={() => onDone(task)}
            >
              <Check size={18} weight="bold" />
            </button>
          )}
        </div>
      </div>
      <div className={`table-row desktop-register-row ${task.status === "blocked" ? "blocked-row" : ""}`}>
        <div className="task-cell register-edit-cell">
          {dueToday && <Warning size={20} className="red-icon" />}
          {task.status === "blocked" && (
            <span className="blocked-indicator">
              <Warning size={19} />
            </span>
          )}
          <input
            className="inline-input task-input"
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
            aria-label={`Task name for ${task.title}`}
          />
          {task.recurring && <span className="recurring-label">Weekly</span>}
          {task.blocker && <small>{task.blocker}</small>}
          <button
            className="row-edit-details"
            onClick={() => onEdit(task)}
            aria-label={`Open full details for ${task.title}`}
          >
            <PencilSimple size={14} />
          </button>
        </div>
        <label className="register-edit-cell" data-label="Project">
          <span className="sr-only">Project</span>
          <select
            className="inline-input project-inline-select"
            value={draft.project}
            onChange={(event) => update("project", event.target.value)}
          >
            {projectOptions.includes(draft.project) || !draft.project ? (
              <option value="">{draft.project || "Select active project"}</option>
            ) : (
              <option value={draft.project}>{draft.project} · Finished</option>
            )}
            {projectOptions
              .filter((project) => project !== draft.project)
              .map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
          </select>
        </label>
        <label
          className={`register-edit-cell ${dueToday ? "due-today" : !draft.deadlineKey ? "no-deadline" : ""}`}
          data-label="Deadline"
        >
          <span className="sr-only">Deadline</span>
          <input
            className="inline-input"
            type="date"
            value={draft.deadlineKey || ""}
            onChange={(event) => update("deadline", event.target.value)}
          />
        </label>
        <label className={`register-edit-cell ${ownerMissing ? "unassigned-owner" : ""}`} data-label="Owner">
          <span className="sr-only">Owner</span>
          <input
            className="inline-input"
            value={draft.owner}
            onChange={(event) => update("owner", event.target.value)}
          />
        </label>
        <label className={`register-edit-cell ${effortMissing ? "zero-effort" : ""}`} data-label="Effort">
          <span className="sr-only">Effort</span>
          <input
            className="inline-input effort-input"
            type="number"
            min="0.25"
            step="0.25"
            inputMode="decimal"
            value={draft.effortHours}
            onChange={(event) => update("effortHours", event.target.value)}
          />
        </label>
        <div className="register-row-actions">
          {showSubtaskAction && Number(draft.effortHours) > 1 && (
            <button
              className="subtask-button icon-action-button"
              title={hasDraftSubtasks ? "Regenerate subtasks" : "Create subtasks"}
              aria-label={hasDraftSubtasks ? "Regenerate subtasks" : "Create subtasks"}
              onClick={() => onCreateSubtasks({ ...task, ...draft })}
            >
              <Sparkle size={16} />
            </button>
          )}
          {changed && (
            <button className="save-row-button" onClick={save}>
              Save
            </button>
          )}
          {task.status === "blocked" ? (
            <button className="row-action" onClick={() => onClearBlocker(task)}>
              Clear blocker
            </button>
          ) : (
            <button
              className="row-action icon-action-button done-action-button"
              title="Mark done"
              aria-label="Mark done"
              onClick={() => onDone(task)}
            >
              <Check size={18} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </Fragment>
  );
}

function DraftSubtaskRow({ parent, draft, projectOptions, onChange, onSave }) {
  return (
    <div className="table-row draft-subtask-row">
      <div className="task-cell register-edit-cell">
        <ArrowRight size={15} className="subtask-indent" />
        <input
          className="inline-input task-input"
          value={draft.title}
          placeholder="Add a subtask"
          onChange={(event) => onChange("title", event.target.value)}
          aria-label={`Draft subtask name for ${parent.title}`}
        />
        {draft.aiSuggested && <span className="ai-draft-label">AI suggested</span>}
      </div>
      <label className="register-edit-cell" data-label="Project">
        <span className="sr-only">Project</span>
        <select
          className="inline-input project-inline-select"
          value={draft.project}
          onChange={(event) => onChange("project", event.target.value)}
        >
          <option value="">Select active project</option>
          {projectOptions.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </label>
      <label className="register-edit-cell" data-label="Deadline">
        <span className="sr-only">Deadline</span>
        <input
          className="inline-input"
          type="date"
          value={draft.deadlineKey || ""}
          onChange={(event) => onChange("deadline", event.target.value)}
        />
      </label>
      <label className="register-edit-cell" data-label="Owner">
        <span className="sr-only">Owner</span>
        <input
          className="inline-input"
          value={draft.owner}
          placeholder="Owner"
          onChange={(event) => onChange("owner", event.target.value)}
        />
      </label>
      <label className="register-edit-cell" data-label="Effort">
        <span className="sr-only">Effort</span>
        <input
          className="inline-input effort-input"
          type="number"
          min="0.25"
          step="0.25"
          inputMode="decimal"
          value={draft.effortHours}
          placeholder="Hours"
          onChange={(event) => onChange("effortHours", event.target.value)}
        />
      </label>
      <div className="register-row-actions">
        <button className="save-row-button" disabled={!draft.title.trim()} onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function CompletedView({ completed, scoreEvents = [], period, setPeriod, onUndo }) {
  const history = scoreEvents.length
    ? scoreEvents
    : completed.map((item) => ({ date: item.date, amount: item.points }));
  const periodDays = period === "Last 30 days" ? 30 : 7;
  const chartDays = Array.from({ length: periodDays }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (periodDays - 1 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      key,
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      label:
        periodDays === 30
          ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : date.toLocaleDateString("en-US", { weekday: "short" }),
    };
  });
  const rangeStart = chartDays[0].key;
  const inPeriod = (dateKey) => Boolean(dateKey && dateKey >= rangeStart && dateKey <= todayKey());
  const scoreHistory = history.filter((item) => inPeriod(item.dateKey));
  const completedInPeriod = completed.filter((item) => inPeriod(item.dateKey));
  const total = scoreHistory.reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0);
  const tasksAdded = scoreEvents.filter((item) => item.cause === "task added" && inPeriod(item.dateKey)).length;
  const bars = chartDays.map((day) => ({
    ...day,
    value: scoreHistory
      .filter((item) => item.dateKey === day.key)
      .reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0),
  }));
  const peak = Math.max(...bars.map((bar) => bar.value), 0);
  const max = Math.max(10, Math.ceil(peak / 10) * 10);
  const yTicks = [max, Math.round(max / 2), 0];
  const [sort, setSort] = useState({ key: "createdAt", direction: "desc" });
  const [activeBar, setActiveBar] = useState(null);
  const activity = useMemo(
    () => [
      ...completed.map((item) => ({ ...item, activity: "Completed", canUndo: true })),
      ...scoreEvents
        .filter((item) => item.cause === "task added")
        .map((item) => ({
          id: `score-${item.id}`,
          title: item.title || "Task",
          project: item.project || "Unassigned",
          date: item.date,
          dateKey: item.dateKey,
          createdAt: item.createdAt,
          points: item.amount,
          activity: "Task added",
          canUndo: false,
        })),
    ],
    [completed, scoreEvents],
  );
  const sortedActivity = useMemo(
    () =>
      [...activity].sort((a, b) => {
        const getValue = (item) =>
          sort.key === "createdAt"
            ? Date.parse(item.createdAt || item.dateKey || 0)
            : sort.key === "date"
              ? item.dateKey || Date.parse(`${item.date} 2026`) || 0
              : sort.key === "points"
                ? Number(item.points)
                : String(item[sort.key] || "");
        const left = getValue(a);
        const right = getValue(b);
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return sort.direction === "asc" ? comparison : -comparison;
      }),
    [activity, sort],
  );
  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  return (
    <section className="screen-content completed-screen">
      <div className="period-toolbar">
        <label className="select-wrap">
          <span className="sr-only">Summary period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
          </select>
          <CaretDown size={17} />
        </label>
      </div>
      <div className="metric-grid">
        <Metric label="Period score" value={`${total} pts`} icon={Sparkle} />
        <Metric label="Tasks completed" value={`${completedInPeriod.length} tasks`} icon={CheckCircle} />
        <Metric label="Tasks added" value={`${tasksAdded} tasks`} icon={StackSimple} />
      </div>
      <div className="chart-section">
        <h2>Score by day</h2>
        <div className="chart-plot">
          <div className="chart-y-axis" aria-hidden="true">
            {yTicks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
          <div
            className={`bar-chart bar-chart-${periodDays}`}
            aria-label={`Score by day for the ${period.toLowerCase()}, scaled from zero to ${max} points`}
          >
            {bars.map((bar) => {
              const height = bar.value ? Math.max(4, (bar.value / max) * 100) : 0;
              const isActive = activeBar === bar.key;
              return (
                <div className="bar-column" key={bar.key}>
                  <div className="bar-track">
                    <button
                      type="button"
                      className={`bar-hit ${isActive ? "active" : ""}`}
                      style={{ "--bar-height": `${height}%` }}
                      onMouseEnter={() => setActiveBar(bar.key)}
                      onMouseLeave={() => setActiveBar(null)}
                      onFocus={() => setActiveBar(bar.key)}
                      onBlur={() => setActiveBar(null)}
                      onClick={() => setActiveBar((current) => (current === bar.key ? null : bar.key))}
                      aria-label={`${bar.label}: ${bar.value} points`}
                      aria-pressed={isActive}
                    >
                      {isActive && (
                        <span className="bar-tooltip" role="tooltip">
                          {bar.value} {bar.value === 1 ? "point" : "points"}
                        </span>
                      )}
                      <span className="bar" style={{ height: `${height}%` }} />
                    </button>
                  </div>
                  <span>{bar.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="completed-section">
        <div className="section-title-row">
          <h2>Task activity</h2>
        </div>
        <div className="completed-table-wrap">
          <div className="completed-table completed-activity-table" role="table" aria-label="Task score activity">
            <div className="completed-table-head" role="row">
              <SortHeader label="Task" sortKey="title" sort={sort} onSort={toggleSort} />
              <SortHeader label="Project" sortKey="project" sort={sort} onSort={toggleSort} />
              <SortHeader label="Activity" sortKey="activity" sort={sort} onSort={toggleSort} />
              <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggleSort} />
              <SortHeader label="Score" sortKey="points" sort={sort} onSort={toggleSort} />
              <span />
            </div>
            {sortedActivity.map((item) => (
              <div className="completed-table-row" role="row" key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.project}</span>
                <span className="score-activity-label">{item.activity}</span>
                <span>{item.date}</span>
                <strong>{item.points ? `+${item.points} pts` : "No points"}</strong>
                {item.canUndo ? (
                  <button className="secondary-button undone-button" onClick={() => onUndo(item)}>
                    Mark undone
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {!sortedActivity.length && (
              <EmptyState
                icon={CheckCircle}
                title="No task activity"
                copy="Completed work and new tasks will appear here."
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  return (
    <button
      className={`sortable-header ${active ? "active" : ""}`}
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
      aria-sort={active ? sort.direction : "none"}
    >
      {label}
      {active ? sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : <ArrowsDownUp size={13} />}
    </button>
  );
}

function Metric({ label, value, note, icon: Icon }) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        <Icon size={19} /> {label}
      </div>
      <strong>{value}</strong>
      {note && <small className="metric-note">{note}</small>}
    </div>
  );
}

function EmptyState({ icon: Icon, title, copy }) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

export {
  NavButton,
  Overview,
  OverviewCard,
  OverviewMilestoneCard,
  getLastSevenScoreDays,
  ScoreLineChart,
  ReviewQueue,
  QueueCard,
  ProjectView,
  ProjectStatusColumn,
  MilestonesView,
  MilestoneTimeline,
  MilestoneTimelineEntry,
  MilestoneCard,
  MilestoneList,
  MilestoneListRow,
  urgencyLabel,
  milestoneUrgency,
  milestoneTimingLabel,
  formatMilestoneDate,
  activeProjectNames,
  WorkRegister,
  RegisterSummaryCard,
  NewTaskRow,
  RegisterRow,
  DraftSubtaskRow,
  CompletedView,
  SortHeader,
  Metric,
  EmptyState,
};
