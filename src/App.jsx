import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowsDownUp,
  CalendarBlank,
  Check,
  CheckCircle,
  CaretDown,
  CircleNotch,
  Clock,
  DotsSixVertical,
  EnvelopeSimple,
  FileArrowUp,
  FileText,
  Briefcase,
  House,
  ListChecks,
  MagnifyingGlass,
  MicrosoftTeamsLogo,
  NotePencil,
  PencilSimple,
  Plus,
  PlugsConnected,
  SlidersHorizontal,
  Sparkle,
  StackSimple,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { backendApi } from "./api";

const navItems = [
  { id: "overview", label: "Overview", icon: House },
  { id: "extract", label: "Extract tasks", icon: FileArrowUp },
  { id: "register", label: "Work register", icon: ListChecks },
  { id: "review", label: "Review queue", icon: Archive },
  { id: "project", label: "Project view", icon: Briefcase },
  { id: "milestones", label: "Milestones & deadlines", icon: CalendarBlank },
  { id: "completed", label: "Completed & score", icon: CheckCircle },
];

function App() {
  const [screen, setScreen] = useState("overview");
  const [queue, setQueue] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [scoreEvents, setScoreEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectFilter, setProjectFilter] = useState("All projects");
  const [selectedProject, setSelectedProject] = useState("");
  const [newTaskRequest, setNewTaskRequest] = useState(0);
  const [period, setPeriod] = useState("Last 7 days");
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [profile, setProfile] = useState({ name: "Ann", email: "" });
  const [refreshing, setRefreshing] = useState(false);
  const applyLiveState = (state) => {
    const liveTasks = state?.tasks || [];
    setQueue(state?.queue || []);
    setTasks(liveTasks);
    setMilestones(state?.milestones || []);
    setCompleted(state?.completed || []);
    setScoreEvents(state?.scoreEvents || []);
    setProjects(state?.projects || []);
    if (state?.profile) setProfile(state.profile);
    if (!selectedProject) {
      const firstProject = (state?.projects || []).find((project) => project.status === "active")?.name || liveTasks.find((task) => task.project)?.project || state?.completed?.find((item) => item.project)?.project || "";
      if (firstProject) setSelectedProject(firstProject);
    }
  };

  const refreshLiveState = async () => {
    const state = await backendApi.state();
    applyLiveState(state);
    return state;
  };

  const refreshRegister = async () => {
    setRefreshing(true);
    try {
      const existingTaskIds = new Set(tasks.map((task) => task.id));
      const state = await backendApi.sync();
      applyLiveState(state);
      const importedTasks = (state?.tasks || []).filter((task) => !existingTaskIds.has(task.id));
      if (importedTasks.length) {
        setCelebration({ id: Date.now(), points: importedTasks.length });
        window.setTimeout(() => setCelebration(null), 2300);
        showNotice(`${importedTasks.length} new ${importedTasks.length === 1 ? "task was" : "tasks were"} imported from Smartsheet. +${importedTasks.length} point${importedTasks.length === 1 ? "" : "s"} added`);
      } else {
        showNotice("Work register refreshed from Smartsheet");
      }
    } catch (error) {
      showNotice(error.message || "Could not refresh from Smartsheet");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadBackendState = () => backendApi.state()
      .then((state) => { if (active) applyLiveState(state); })
      .catch((error) => { if (active) showNotice(error.message || "Could not load your saved Workboard data"); });
    loadBackendState();
    const retry = window.setTimeout(loadBackendState, 1200);
    return () => { active = false; window.clearTimeout(retry); };
  }, []);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };


  const importConnectorData = async (source, content) => {
    try {
      const result = await backendApi.importConnectorData(source, content);
      applyLiveState(result.state);
      setScreen("review");
      showNotice(`${result.extracted} ${result.extracted === 1 ? "item was" : "items were"} extracted into the Review queue`);
      return result;
    } catch (error) {
      showNotice(error.message || "Connector import failed");
      throw error;
    }
  };

  const sendExtractedToQueue = (items, fileName, navigate = true) => {
    const entries = items.map((item, index) => { const isMilestone = item.type === "MILESTONE"; return { id: item.sourceItemId ? `${item.sourceItemId}:${item.extractedIndex}` : `file-draft-${Date.now()}-${index}`, sourceItemId: item.sourceItemId, extractedIndex: item.extractedIndex, type: "draft", itemKind: isMilestone ? "MILESTONE" : "TASK", source: `Dropped file · ${fileName}`, sourceKind: "file", title: item.title, project: item.project || "", owner: item.owner || "", deadline: item.dateLabel || "", deadlineKey: item.dateKey || null, effortHours: item.effortHours || 1, notes: item.evidence || "", notesAi: Boolean(item.evidence), badge: "AI drafted", detail: `${isMilestone ? "Milestone" : "Task"}${isMilestone ? "" : ` · ${item.owner || "Owner unclear"}`} · ${item.dateLabel || "Date unclear"}` }; });
    setQueue((current) => [...entries, ...current]);
    if (navigate) setScreen("review");
    showNotice(`${entries.length} extracted ${entries.length === 1 ? "item was" : "items were"} sent to the review queue`);
  };


  const approveDraft = async (item, values = item) => {
    try {
      const isMilestone = item.itemKind === "MILESTONE";
      if (item.sourceItemId) await backendApi.approveSourceItem(item.sourceItemId, item.extractedIndex, values);
      else if (isMilestone) await backendApi.createMilestone({ name: values.title, date: values.deadline, project: values.project, type: values.milestoneType });
      else await backendApi.createTask(values);
      await refreshLiveState();
      setModal(null);
      setCelebration({ id: Date.now(), points: isMilestone ? null : 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice(isMilestone ? "Milestone approved and added to Milestones & deadlines" : "Task approved and added to your work register. +1 point added");
    } catch (error) { showNotice(error.message || "Approval failed"); }
  };

  const dismissQueueItem = async (id, item = queue.find((entry) => entry.id === id)) => {
    try {
      if (item?.sourceItemId) await backendApi.dismissSourceItem(item.sourceItemId, item.extractedIndex);
      else if (item?.exceptionId) await backendApi.dismissException(item.exceptionId);
      await refreshLiveState();
      setModal(null);
      showNotice("Removed from the review queue");
    } catch (error) { showNotice(error.message || "Could not remove the item"); }
  };

  const markDone = async (task) => {
    if (task.status === "blocked") return;
    try {
      await backendApi.completeTask(task.id);
      await refreshLiveState();
      const points = isAnnOwner(task.owner) ? task.points : null;
      setCelebration({ id: Date.now(), points });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice(points ? `Completed. +${points} points added` : "Completed. No points awarded because Ann is not the owner");
    } catch (error) { showNotice(error.message || "Could not complete the task"); }
  };

  const clearBlocker = async (task) => {
    try { await backendApi.updateTask(task.id, { ...task, deadline: task.deadline, status: "active", blocker: "" }); await refreshLiveState(); showNotice("Blocker cleared"); } catch (error) { showNotice(error.message || "Could not clear blocker"); }
  };
  const undoCompleted = async (item) => {
    try { await backendApi.undoCompleted(item.id); await refreshLiveState(); setScreen("register"); showNotice("Task marked undone and returned to the Work register"); } catch (error) { showNotice(error.message || "Could not mark task undone"); }
  };
  const retryException = async () => { showNotice("Source retry is unavailable in local-only mode"); };
  const applyCreatedTask = (result) => {
    const task = result?.task || result;
    if (task?.id) setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    if (result?.scoreEvent?.id) setScoreEvents((current) => [result.scoreEvent, ...current.filter((item) => item.id !== result.scoreEvent.id)]);
  };
  const createTask = async (values) => {
    try {
      const result = await backendApi.createTask(values);
      applyCreatedTask(result);
      refreshLiveState().catch(() => {});
      setModal(null);
      setCelebration({ id: Date.now(), points: 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice("New task added to your work register. +1 point added");
    } catch (error) { showNotice(error.message || "Could not create the task"); }
  };
  const createRecurringTask = async (values) => {
    try {
      const result = await backendApi.createRecurringTask(values);
      applyCreatedTask(result);
      refreshLiveState().catch(() => {});
      setModal(null);
      setCelebration({ id: Date.now(), points: 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice("Weekly task created. Its next occurrence will appear after completion.");
    } catch (error) { showNotice(error.message || "Could not create recurring task"); }
  };

  const createProject = async (name) => {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return;
    const optimisticProject = { id: `local-project-${Date.now()}`, name: trimmedName, status: "active" };
    setProjects((current) => current.some((project) => project.name.toLowerCase() === trimmedName.toLowerCase()) ? current : [...current, optimisticProject]);
    setSelectedProject(trimmedName);
    try { const savedProject = await backendApi.createProject(trimmedName); setProjects((current) => current.map((project) => project.name === trimmedName ? savedProject : project)); await refreshLiveState(); showNotice("Project created and added to active projects"); } catch (error) { showNotice("Project added locally; persistence is unavailable"); }
  };

  const updateProjectStatus = async (name, status) => {
    try { await backendApi.updateProjectStatus(name, status); await refreshLiveState(); if (status === "finished" && selectedProject === name) setSelectedProject(""); showNotice(status === "finished" ? "Project moved to finished" : "Project restored to active"); } catch (error) { showNotice(error.message || "Could not update project"); }
  };

  const updateTask = async (taskId, values) => {
    try {
      const updatedTask = await backendApi.updateTask(taskId, values);
      setTasks((current) => current.map((task) => task.id === taskId ? updatedTask : task));
      setModal(null);
      showNotice("Task details updated");
    } catch (error) { showNotice(error.message || "Could not update the task"); }
  };

  const createSubtask = async (parentTask, values) => {
    try {
      const result = await backendApi.createTask({ ...values, parentTaskId: parentTask.id, notes: `AI suggested subtask for ${parentTask.title}`, notesAi: true });
      applyCreatedTask(result);
      refreshLiveState().catch(() => {});
      setCelebration({ id: Date.now(), points: 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice("Subtask saved and added to the Work register. +1 point added");
    } catch (error) { showNotice(error.message || "Could not save subtask"); }
  };

  const addMilestone = async (values) => {
    try { const milestone = await backendApi.createMilestone(values); setMilestones((current) => [...current, milestone]); showNotice("Milestone added"); } catch (error) { showNotice(error.message || "Could not add milestone"); }
  };
  const updateMilestone = async (milestoneId, values) => {
    try { const milestone = await backendApi.updateMilestone(milestoneId, values); setMilestones((current) => current.map((item) => item.id === milestoneId ? milestone : item)); showNotice("Milestone updated"); } catch (error) { showNotice(error.message || "Could not update milestone"); }
  };
  const deleteMilestone = async (milestoneId) => {
    try { await backendApi.deleteMilestone(milestoneId); setMilestones((current) => current.filter((item) => item.id !== milestoneId)); showNotice("Milestone deleted"); } catch (error) { showNotice(error.message || "Could not delete milestone"); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark"><Sparkle size={18} weight="fill" /></div><div><strong>Workboard</strong><span>Personal operations</span></div></div>
      <nav className="primary-nav" aria-label="Primary navigation">{navItems.map((item) => <NavButton key={item.id} item={item} count={item.id === "review" ? queue.length : item.count} active={screen === item.id} onClick={() => setScreen(item.id)} />)}</nav>
      <div className="sidebar-footer"><div className="source-status"><span className="status-dot" /> Private hosted app</div></div>
    </aside>
    <div className="main-column">
      <header className="mobile-header"><div className="brand-lockup"><div className="brand-mark"><Sparkle size={17} weight="fill" /></div><strong>Workboard</strong></div><button className="icon-button" aria-label="Search" onClick={() => showNotice("Search is ready for your task list")}><MagnifyingGlass size={20} /></button></header>
      <main className="content">
        {!(["milestones", "project"].includes(screen)) && <div className="content-heading"><div><p className="eyebrow">{todayLongLabel()}</p><h1>{navItems.find((item) => item.id === screen)?.label}</h1></div><div className="heading-actions"><button className="primary-button" onClick={() => screen === "register" ? setNewTaskRequest((value) => value + 1) : setModal({ type: "new-task" })}><Plus size={18} weight="bold" /> <span className="desktop-only">New task</span><span className="mobile-only">Add</span></button></div></div>}
        {screen === "overview" && <Overview queue={queue} tasks={tasks} completed={completed} scoreEvents={scoreEvents} onNavigate={setScreen} />}
        {screen === "review" && <ReviewQueue queue={queue} onApprove={approveDraft} onDismiss={dismissQueueItem} onRetry={retryException} onModal={setModal} />}
        {screen === "extract" && <TaskExtraction projects={activeProjectNames(projects)} onSendToQueue={sendExtractedToQueue} onRemove={dismissQueueItem} onNotice={showNotice} />}
        {screen === "register" && <WorkRegister tasks={tasks} projects={projects} projectFilter={projectFilter} setProjectFilter={setProjectFilter} newTaskRequest={newTaskRequest} onConsumeNewTaskRequest={() => setNewTaskRequest(0)} onCreateTask={createTask} onDone={markDone} onClearBlocker={clearBlocker} onUpdate={updateTask} onCreateSubtask={createSubtask} onRefresh={refreshRegister} onCreateRecurring={() => setModal({ type: "recurring-task" })} onEdit={(task) => setModal({ type: "task-edit", task })} />}
        {screen === "project" && <ProjectView project={selectedProject} onProjectChange={setSelectedProject} projects={projects} tasks={tasks} completed={completed} milestones={milestones} onDone={markDone} onClearBlocker={clearBlocker} onUpdate={updateTask} onEdit={(task) => setModal({ type: "task-edit", task })} onCreateProject={createProject} onUpdateProjectStatus={updateProjectStatus} />}
        {screen === "milestones" && <MilestonesView milestones={milestones} tasks={tasks} projects={activeProjectNames(projects)} onAdd={addMilestone} onUpdate={updateMilestone} onDelete={deleteMilestone} />}
        {screen === "completed" && <CompletedView completed={completed} scoreEvents={scoreEvents} tasks={tasks} period={period} setPeriod={setPeriod} onUndo={undoCompleted} />}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map((item) => <NavButton key={item.id} item={item} count={item.id === "review" ? queue.length : item.count} active={screen === item.id} onClick={() => setScreen(item.id)} compact />)}</nav>
    </div>
    {modal && <Modal modal={modal} onClose={() => setModal(null)} onApprove={approveDraft} onDismiss={dismissQueueItem} onNotice={showNotice} onNewTask={createTask} onCreateRecurring={createRecurringTask} onUpdateTask={updateTask} projectOptions={activeProjectNames(projects)} />}
    {celebration && <Confetti key={celebration.id} points={celebration.points} />}
    {notice && <div className="toast" role="status"><CheckCircle size={20} weight="fill" /> {notice}</div>}
  </div>;
}

function LiveConnectionGate({ status, health, error, onSignIn }) {
  const configMissing = health && (!health.microsoftConfigured || !health.openAiConfigured || !health.databaseConfigured);
  const heading = status === "loading" ? "Connecting to Workboard" : status === "signin" ? "Sign in to your work account" : "Live connection setup needed";
  return <main className="connection-gate"><div className="connection-gate-card"><div className="modal-icon"><PlugsConnected size={22} /></div><p className="eyebrow">Live data mode</p><h1>{heading}</h1>{status === "loading" ? <p>Checking Microsoft 365 and local PostgreSQL.</p> : status === "signin" ? <><p>Workboard is ready for your West Monroe Microsoft 365 account. Sign in to load your real email, calendar, Teams chat signals, and saved tasks.</p><button className="primary-button" onClick={onSignIn}><MicrosoftTeamsLogo size={18} /> Sign in with Microsoft</button></> : <><p>{configMissing ? "Add the missing local configuration before connecting live sources." : error || "The live service could not be reached."}</p>{health && <ul className="connection-checklist"><li className={health.databaseConfigured ? "ready" : "missing"}>Local PostgreSQL {health.databaseConfigured ? "ready" : "not configured"}</li><li className={health.microsoftConfigured ? "ready" : "missing"}>Microsoft Entra app {health.microsoftConfigured ? "ready" : "not configured"}</li><li className={health.openAiConfigured ? "ready" : "missing"}>OpenAI extraction {health.openAiConfigured ? "ready" : "not configured"}</li></ul>}<p className="connection-help">Update the local <code>.env</code> file, then restart the backend and refresh this page.</p></>}</div></main>;
}

function NavButton({ item, count, active, onClick, compact = false }) { const Icon = item.icon; return <button className={`nav-button ${active ? "active" : ""} ${compact ? "compact" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={compact ? 21 : 20} weight={active ? "fill" : "regular"} /><span>{item.label}</span>{count > 0 && <span className="nav-count">{count}</span>}</button>; }

function Overview({ queue, tasks, completed, scoreEvents, onNavigate }) {
  const dueToday = tasks.filter((task) => task.deadline === "Today").length;
  const scoreDays = getLastSevenScoreDays(completed, scoreEvents);
  const periodScore = scoreDays.reduce((sum, day) => sum + day.value, 0);
  return <section className="screen-content overview-screen"><div className="overview-intro"><p>One place to see what needs your attention and how your week is moving.</p></div><div className="overview-grid"><OverviewCard icon={Archive} label="Review queue" value={`${queue.length}`} detail={`${queue.length === 1 ? "item" : "items"} to review`} tone="amber" onClick={() => onNavigate("review")} /><OverviewCard icon={ListChecks} label="Work register" value={`${dueToday}`} detail={`${dueToday === 1 ? "item" : "items"} due today`} tone="red" onClick={() => onNavigate("register")} /><button className="overview-card overview-score-card" onClick={() => onNavigate("completed")} type="button"><div className="overview-card-top"><span className="overview-card-label"><CheckCircle size={19} /> Score</span><ArrowRight size={20} /></div><strong>{periodScore} pts</strong><p>Past 7 days</p><ScoreLineChart points={scoreDays} /><div className="score-axis">{scoreDays.map((day) => <span key={day.short}>{day.label}</span>)}</div></button></div></section>;
}

function OverviewCard({ icon: Icon, label, value, detail, secondary, tone, onClick }) { return <button className={`overview-card overview-${tone}`} onClick={onClick} type="button"><div className="overview-card-top"><span className="overview-card-label"><Icon size={19} /> {label}</span><ArrowRight size={20} /></div><strong>{value}</strong><p>{detail}</p>{secondary && <small>{secondary}</small>}</button>; }

function getLastSevenScoreDays(completed, scoreEvents = []) {
  const history = scoreEvents.length ? scoreEvents : completed.map((item) => ({ date: item.date, dateKey: item.dateKey, amount: item.points }));
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const short = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { short, dateKey, label: date.toLocaleDateString("en-US", { weekday: "short" }), value: history.filter((item) => item.dateKey === dateKey).reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0) };
  });
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayLongLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function profileInitials(name) {
  return String(name || "Microsoft 365 user").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
      const x = (index) => points.length === 1 ? width / 2 : 12 + (index / (points.length - 1)) * (width - 24);
      const y = (value) => height - 12 - (value / max) * (height - 24);
      context.strokeStyle = "#dbe8e6";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height - 12);
      context.lineTo(width, height - 12);
      context.stroke();
      context.strokeStyle = "#087b72";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      points.forEach((point, index) => { if (index === 0) context.moveTo(x(index), y(point.value)); else context.lineTo(x(index), y(point.value)); });
      context.stroke();
      points.forEach((point, index) => { context.fillStyle = "#fff"; context.beginPath(); context.arc(x(index), y(point.value), 4, 0, Math.PI * 2); context.fill(); context.fillStyle = "#087b72"; context.beginPath(); context.arc(x(index), y(point.value), 2.5, 0, Math.PI * 2); context.fill(); });
    };
    draw();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    observer?.observe(canvas);
    window.addEventListener("resize", draw);
    return () => { observer?.disconnect(); window.removeEventListener("resize", draw); };
  }, [points]);
  return <canvas ref={canvasRef} className="score-line-chart" role="img" aria-label="Points earned over the past seven days" />;
}

function ConnectorImport({ onImport }) {
  const [source, setSource] = useState("outlook_email");
  const [content, setContent] = useState("");
  const [importing, setImporting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim() || importing) return;
    setImporting(true);
    try {
      await onImport(source, content);
      setContent("");
    } catch {
      // The parent shows the actionable error in the app toast.
    } finally {
      setImporting(false);
    }
  };

  return <section className="screen-content connector-import-screen">
    <div className="connector-import-intro"><div><p>Temporary bridge while Microsoft Entra is pending.</p><h2>Paste read-only connector results</h2><p>Copy Outlook email, Outlook calendar, or Teams results from ChatGPT and paste them below. Workboard will run the same deep AI extraction and send every proposed task or milestone to the Review queue.</p></div><span className="read-only-note"><PlugsConnected size={16} /> No messages or calendar items are changed</span></div>
    <form className="connector-import-form" onSubmit={submit}>
      <div className="connector-import-fields"><label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="outlook_email">Outlook email</option><option value="outlook_calendar">Outlook calendar</option><option value="teams_chat">Microsoft Teams chat</option></select></label><span className="connector-import-hint">Paste JSON or plain-text results. JSON arrays and Graph-style {`{"value": [...]}`} responses are supported.</span></div>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste the connector results here..." aria-label="Connector results" rows={16} />
      <div className="connector-import-footer"><span>{content.length.toLocaleString()} characters</span><div><button className="secondary-button" type="button" onClick={() => setContent("")} disabled={!content || importing}>Clear</button><button className="primary-button" type="submit" disabled={!content.trim() || importing}><Sparkle size={17} /> {importing ? "Extracting..." : "Extract into Review queue"}</button></div></div>
    </form>
    <div className="connector-import-steps"><strong>How to use it</strong><span>1. Ask ChatGPT to read the connected source.</span><span>2. Copy the returned results.</span><span>3. Paste here and approve the resulting drafts in Review queue.</span></div>
  </section>;
}

function TaskExtraction({ projects, onSendToQueue, onRemove, onNotice }) {
  const [fileState, setFileState] = useState(null);
  const [items, setItems] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [rawText, setRawText] = useState("");
  const [extractingText, setExtractingText] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);

  useEffect(() => () => {
    if (fileState?.url) URL.revokeObjectURL(fileState.url);
  }, [fileState?.url]);

  const loadFile = async (file) => {
    if (!file) return;
    setExtractingFile(true);
    setItems([]);
    try {
      const url = URL.createObjectURL(file);
      const preview = await parseFilePreview(file);
      const dataUrl = file.size <= 6 * 1024 * 1024 && preview.kind !== "text" ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(""); reader.readAsDataURL(file); }) : "";
      setFileState({ name: file.name, size: formatFileSize(file.size), url, kind: preview.kind, page: 1, pageCount: preview.pages.length || 1, pages: preview.pages, text: preview.text });
      const result = await backendApi.extractFile(file.name, file.type || "text/markdown", preview.text, dataUrl, projects);
      const fallbackItems = /\.(md|markdown)$/i.test(file.name) ? extractTaskItems(file.name, preview.text) : [];
      const extractedItems = result.items?.length ? result.items : fallbackItems;
      setItems(extractedItems);
      onNotice(`AI completed a full pass and extracted ${extractedItems.length} items from ${file.name}`);
    } catch (error) {
      const fallbackItems = /\.(md|markdown)$/i.test(file.name) ? extractTaskItems(file.name, (await parseFilePreview(file)).text) : [];
      if (fallbackItems.length) { setItems(fallbackItems); onNotice(`Backend unavailable; extracted ${fallbackItems.length} Markdown tasks locally`); } else onNotice(error.message || "Could not extract tasks from this file");
    } finally { setExtractingFile(false); }
  };

  const replaceFile = (event) => loadFile(event.target.files?.[0]);
  const extractRawText = async () => {
    const text = rawText.trim();
    if (!text || extractingText) return;
    setExtractingText(true);
    try {
      const result = await backendApi.extractFile("Pasted text.md", "text/markdown", text, "", projects);
      setFileState({ name: "Pasted text.md", size: `${text.length} characters`, url: "", kind: "text", page: 1, pageCount: 1, pages: [text.split(/\r?\n/)], text });
      const extractedItems = result.items?.length ? result.items : extractTaskItems("Pasted text.md", text);
      setItems(extractedItems);
      onNotice(`AI completed a full pass and extracted ${extractedItems.length} items from pasted text`);
    } catch (error) { const fallbackItems = extractTaskItems("Pasted text.md", text); if (fallbackItems.length) { setFileState({ name: "Pasted text.md", size: `${text.length} characters`, url: "", kind: "text", page: 1, pageCount: 1, pages: [text.split(/\r?\n/)], text }); setItems(fallbackItems); onNotice(`Backend unavailable; extracted ${fallbackItems.length} Markdown tasks locally`); } else onNotice(error.message || "Could not extract tasks from pasted text"); }
    finally { setExtractingText(false); }
  };
  const handleDrop = (event) => {
    event.preventDefault();
    setDragActive(false);
    loadFile(event.dataTransfer.files?.[0]);
  };
  const approveOne = (item) => {
    onSendToQueue([item], fileState.name, false);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };
  const removeOne = async (item) => {
    await onRemove(item.id, item);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };
  const approveAll = () => {
    const count = items.length;
    onSendToQueue(items, fileState.name);
    setItems([]);
    onNotice(`${count} extracted ${count === 1 ? "item was" : "items were"} added to the review queue`);
  };
  return <section className="screen-content extraction-screen">
    <div className="extraction-intro"><p>Drop a source file here and Workboard will identify tasks, owners, and dates for a quick first pass.</p><span className="read-only-note"><Sparkle size={15} /> AI suggestions stay yours to approve</span></div>
    <div className="extraction-layout">
      <section className="extraction-pane preview-pane" aria-label="File preview">
        {!fileState ? <><div className={`extraction-drop-zone ${dragActive ? "drag-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop}><div className="drop-icon"><FileArrowUp size={25} /></div><h2>Drop a file to extract tasks</h2><p>PDF, DOC, DOCX, TXT, MD, PPT, and images or screenshots</p><label className="primary-button browse-file-button">Choose a file<input type="file" accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,image/*" onChange={replaceFile} /></label></div><div className="raw-text-entry"><label htmlFor="raw-task-text">Or paste raw text</label><textarea id="raw-task-text" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="Paste meeting notes, a transcript, or Markdown here..." rows={6} /><button className="secondary-button" type="button" disabled={!rawText.trim() || extractingText} onClick={extractRawText}><Sparkle size={17} /> {extractingText ? "Extracting..." : "Extract from text"}</button>{extractingText && <p className="extraction-status" role="status">AI is reviewing the pasted text for tasks, milestones, dates, and owners...</p>}</div></> : <>
          <div className="file-preview-toolbar"><div className="file-preview-title"><FileText size={21} /><div><strong>{fileState.name}</strong><small>{fileState.size} · {fileKindLabel(fileState.kind)}</small></div></div><label className="secondary-button replace-file-button">Replace file<input type="file" accept=".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,image/*" onChange={replaceFile} /></label></div>
          <div className="file-preview-stage">{fileState.kind === "image" && <img src={fileState.url} alt={`Preview of ${fileState.name}`} />}{fileState.kind === "pdf" && <iframe src={fileState.url} title={`Preview of ${fileState.name}`} />}{fileState.kind === "text" && <pre>{fileState.text || "No readable text was found in this file."}</pre>}{fileState.kind === "office" && <div className="document-page-stack">{fileState.pages.map((page, index) => <article className="document-page" key={`${fileState.name}-${index}`}><span>Page {index + 1}</span>{page.map((paragraph, paragraphIndex) => <p key={`${index}-${paragraphIndex}`}>{paragraph}</p>)}</article>)}</div>}</div>
          {fileState.pageCount > 1 && <div className="page-indicator">Page {fileState.page} of {fileState.pageCount}</div>}
        </>}
      </section>
      <section className="extraction-pane items-pane" aria-label="Extracted tasks and milestones"><div className="extracted-header"><div><span className="eyebrow">Extracted items</span><h2>{fileState ? `${items.length} ${items.length === 1 ? "item" : "items"}` : "Nothing extracted yet"}</h2></div>{fileState && <span className={`status-badge ${extractingFile ? "warning" : "success"}`}><Sparkle size={14} /> {extractingFile ? "Processing..." : "AI drafted"}</span>}</div>{fileState && (extractingFile ? <p className="extraction-method-note processing-note" role="status"><Sparkle size={14} /> AI is still reviewing the document. Please wait; tasks, milestones, dates, owners, and supporting evidence are being extracted.</p> : <p className="extraction-method-note"><Sparkle size={14} /> Deep pass complete: scanned document text, headings, lists, tables, roles, and date references.</p>)}{!fileState ? <div className="extracted-empty"><ListChecks size={28} /><p>Items will appear here after you drop in a file.</p></div> : <div className="extracted-list">{items.map((item) => <ExtractedItemCard item={item} key={item.id} onApprove={() => approveOne(item)} onRemove={() => removeOne(item)} />)}{!items.length && <div className="extracted-empty compact">{extractingFile ? <><Sparkle size={27} /><p>Waiting for the backend to finish the deep pass...</p></> : <><CheckCircle size={27} /><p>All extracted items are handled.</p></>}</div>}</div>}</section>
    </div>
    {fileState && <div className="extraction-bottom-bar"><div><strong>{extractingFile ? "Processing document..." : items.length ? `${items.length} items ready` : "Extraction complete"}</strong><span>{extractingFile ? "Please wait while AI completes its deep pass." : "All extracted items go to Review queue first. Full editing happens there before approval into the Work register."}</span></div><div className="extraction-actions"><button className="primary-button" disabled={!items.length || extractingFile} onClick={approveAll}><Check size={18} /> Send all to review queue</button></div></div>}
  </section>;
}

function ExtractedItemCard({ item, onApprove, onRemove }) {
  const missing = [!item.owner && "owner", !item.dateLabel && "target date"].filter(Boolean);
  return <article className={`extracted-item-card ${missing.length ? "missing-item" : ""}`}><div className="extracted-item-main"><div className="extracted-item-top"><span className="item-type-label">{item.type}</span>{missing.length > 0 && <span className="missing-label"><Warning size={14} /> Needs input</span>}</div><h3>{item.title}</h3><div className="extracted-item-meta"><span>{item.owner || "Owner not found"}</span><span>{item.dateLabel || "Target date not found"}</span></div>{missing.length > 0 && <p className="extracted-missing">Missing: {missing.join(", ")}</p>}</div><div className="extracted-item-actions"><button className="quick-remove-button" onClick={onRemove} aria-label={`Remove ${item.title}`}><X size={20} /></button><button className="quick-approve-button" onClick={onApprove} aria-label={`Send ${item.title} to the review queue`}><Check size={20} /></button></div></article>;
}

function filePreviewKind(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|svg)$/.test(name)) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("text/") || /\.(txt|md|markdown)$/.test(name)) return "text";
  if (/\.(doc|docx|ppt|pptx)$/.test(name) || file.type.includes("word") || file.type.includes("presentation")) return "office";
  return "office";
}

function fileKindLabel(kind) {
  return kind === "pdf" ? "PDF" : kind === "text" ? "Text file" : kind === "image" ? "Image" : "Office file";
}

async function parseFilePreview(file) {
  const kind = filePreviewKind(file);
  if (kind === "text") {
    const text = await file.text().catch(() => "");
    return { kind, text, pages: [text.split(/\r?\n/)] };
  }
  if (kind === "office" && /\.(docx|pptx)$/i.test(file.name)) {
    try {
      const pages = await parseOfficeArchive(file);
      return { kind, text: pages.flat().join("\n"), pages };
    } catch (error) {
      return { kind, text: "", pages: [[`The ${file.name} file loaded, but its document content could not be decoded in this browser.`]] };
    }
  }
  return { kind, text: "", pages: [[`${file.name} is ready for extraction.`]] };
}

async function parseOfficeArchive(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));
    const dataStart = nameStart + fileNameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name === "word/document.xml" || /^ppt\/slides\/slide\d+\.xml$/i.test(name)) {
      let content = compressed;
      if (compression === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        content = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      entries.set(name, decoder.decode(content));
    }
    offset = dataStart + compressedSize;
  }
  const slideEntries = [...entries.keys()].filter((name) => name.startsWith("ppt/slides/slide")).sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1] || 0) - Number(right.match(/slide(\d+)/i)?.[1] || 0));
  if (entries.has("word/document.xml")) return chunkDocumentPages(xmlParagraphs(entries.get("word/document.xml"), "http://schemas.openxmlformats.org/wordprocessingml/2006/main"));
  if (slideEntries.length) return slideEntries.map((name) => xmlParagraphs(entries.get(name), "http://schemas.openxmlformats.org/drawingml/2006/main"));
  throw new Error("No supported office document content found");
}

function xmlParagraphs(xml, namespace) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = [...document.getElementsByTagNameNS(namespace, "p")];
  return paragraphs.map((paragraph) => [...paragraph.getElementsByTagNameNS(namespace, "t")].map((text) => text.textContent || "").join("").trim()).filter(Boolean);
}

function chunkDocumentPages(paragraphs, perPage = 28) {
  const pages = [];
  for (let index = 0; index < paragraphs.length; index += perPage) pages.push(paragraphs.slice(index, index + perPage));
  return pages.length ? pages : [["No readable document text was found."]];
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractTaskItems(fileName, rawText) {
  const lines = rawText.split(/\r?\n|(?<=[.!?])\s+/).map((line) => line.replace(/^\s*(?:[-*+] |\d+[.)]\s+|[-*+]\s+|\[[ xX]\]\s+)/, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim()).filter((line) => line.length >= 8 && line.length <= 220);
  const actionPattern = /\b(review|send|share|draft|prepare|confirm|schedule|update|create|finalize|follow[- ]?up|complete|deliver|launch|milestone|coordinate|validate|rewrite|define|stand up|provision|ingest|build|establish|configure|surface|conduct|support|design|program|produce|enable|identify|provide|read|confirm|agree|execute|sign)\b/i;
  const seen = new Set();
  const parsed = lines.filter((line) => actionPattern.test(line) || /^(phase\s+\d|scope area|nba sidekick activation|sow execution)/i.test(line)).slice(0, 30).map((line, index) => {
    const dateMatch = line.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/i);
    const periodMatch = line.match(/\(~?\s*\d+(?:[–-]\d+)?\s*weeks?\)/i);
    const title = line.replace(/[.!?]+$/, "");
    const type = /^(phase\s+\d|scope area|.*milestone|nba sidekick activation|sow execution)/i.test(line) || /\bmilestone\b|\bactivation\b/i.test(line) ? "MILESTONE" : "TASK";
    const owner = /\bclient\b/i.test(line) ? "Client" : /\bwest monroe\b/i.test(line) ? "West Monroe" : /Jeff Pehler/i.test(line) ? "Jeff Pehler" : /\bSales NBA Product Owner\b/i.test(line) ? "Sales NBA Product Owner" : /\bTechnical Coordinator\b/i.test(line) ? "Technical Coordinator" : "";
    const dateLabel = dateMatch?.[0] || periodMatch?.[0]?.replace(/[()]/g, "") || "";
    const key = title.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return { id: `extracted-${index}-${title.slice(0, 10)}`, type, title, owner, dateLabel, project: "", dateKey: dateMatch ? deadlineKeyFromLabel(dateMatch[0]) : null };
  }).filter(Boolean);
  return parsed;
}

function ReviewQueue({ queue, onApprove, onDismiss, onRetry, onModal }) {
  const [filter, setFilter] = useState("all");
  const filters = [{ id: "all", label: "All", count: queue.length }, { id: "draft", label: "Drafts", count: queue.filter((item) => item.type === "draft").length }, { id: "unclear", label: "Unclear", count: queue.filter((item) => item.type === "unclear").length }, { id: "exception", label: "Exceptions", count: queue.filter((item) => item.type === "exception").length }];
  const visible = queue.filter((item) => filter === "all" || item.type === filter);
  return <section className="screen-content"><div className="tab-row" role="tablist" aria-label="Review queue filters">{filters.map((item) => <button key={item.id} className={`pill-tab ${filter === item.id ? "selected" : ""}`} onClick={() => setFilter(item.id)} role="tab" aria-selected={filter === item.id}>{item.label} <span>{item.count}</span></button>)}</div><div className="queue-list">{visible.map((item) => <QueueCard key={item.id} item={item} onApprove={onApprove} onDismiss={onDismiss} onRetry={onRetry} onModal={onModal} />)}{!visible.length && <EmptyState icon={Archive} title="Nothing needs your review" copy="New drafts and source exceptions will appear here." />}</div></section>;
}

function QueueCard({ item, onApprove, onDismiss, onRetry, onModal }) {
  const SourceIcon = item.sourceKind === "outlook" ? EnvelopeSimple : item.sourceKind === "file" ? FileArrowUp : item.sourceKind === "teams" ? MicrosoftTeamsLogo : PlugsConnected;
  const isUnclear = item.type === "unclear"; const isException = item.type === "exception";
  return <article className={`queue-card ${isUnclear ? "warning-card" : ""} ${isException ? "exception-card" : ""}`}><div className="card-main"><div className="source-line"><SourceIcon size={23} /><span>{item.source}</span>{item.badge && <span className={`status-badge ${isUnclear ? "warning" : "success"}`}>{item.badge}</span>}</div><h2>{item.title}</h2><p className={isUnclear ? "warning-copy" : isException ? "muted-copy" : "meta-copy"}>{item.detail}</p></div><div className="card-actions">{isException ? <><button className="secondary-button" onClick={() => onRetry(item)}><CircleNotch size={19} /> Try again</button><button className="secondary-button" onClick={() => onDismiss(item.id)}><Trash size={17} /> Delete</button></> : isUnclear ? <><button className="secondary-button" onClick={() => onDismiss(item.id)}><Trash size={17} /> Delete</button><button className="primary-button" onClick={() => onModal({ type: "fill", item })}>Fill in</button></> : <><button className="secondary-button" onClick={() => onModal({ type: "edit", item })}><PencilSimple size={18} /> Edit</button><button className="secondary-button" onClick={() => onDismiss(item.id)}><Trash size={17} /> Delete</button><button className="primary-button" onClick={() => onApprove(item)}>Approve</button></>}</div></article>;
}

function ProjectView({ project, onProjectChange, projects, tasks, completed, milestones, onDone, onClearBlocker, onUpdate, onEdit, onCreateProject, onUpdateProjectStatus }) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectDrag, setProjectDrag] = useState(null);
  const activeProjects = projects.filter((item) => item.status === "active");
  const finishedProjects = projects.filter((item) => item.status === "finished");
  const projectTasks = tasks.filter((task) => task.project === project);
  const projectCompleted = completed.filter((item) => item.project === project);
  const projectMilestones = milestones.filter((milestone) => milestone.project === project).map((milestone) => ({ ...milestone, linkedCount: milestone.linkedTaskIds.filter((taskId) => tasks.some((task) => task.id === taskId)).length })).sort((left, right) => (left.dateKey || "9999-12-31").localeCompare(right.dateKey || "9999-12-31"));
  const nextMilestone = projectMilestones.find((milestone) => milestone.dateKey && milestone.dateKey >= todayKey());
  const projectScore = projectCompleted.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const submitProject = (event) => { event.preventDefault(); if (!newProjectName.trim()) return; onCreateProject(newProjectName.trim()); setNewProjectName(""); };
  const dropProject = (status) => { if (projectDrag) onUpdateProjectStatus(projectDrag.name, status); setProjectDrag(null); };
  return <section className="screen-content project-screen">
    <div className="project-view-header">
      <div className="project-title-block"><span className="eyebrow">Single-project view</span><label className="project-switcher"><span className="sr-only">Project</span><select value={project} onChange={(event) => { setCompletedOpen(false); onProjectChange(event.target.value); }}>{projects.map((item) => <option key={item.name} value={item.name}>{item.name}{item.status === "finished" ? " · Finished" : ""}</option>)}</select><CaretDown size={18} /></label></div>
      <div className="project-stats" aria-label={`${project} project stats`}><div className="project-stat"><span>Open</span><strong>{projectTasks.length}</strong></div><div className="project-stat"><span>Completed</span><strong>{projectCompleted.length}</strong></div><div className="project-stat project-next-stat"><span>Next milestone/deadline</span><strong>{nextMilestone ? `${nextMilestone.date} · ${nextMilestone.name}` : "None scheduled"}</strong></div></div>
    </div>
    <section className="project-milestones-section"><div className="section-title-row"><div><h2>Milestones &amp; deadlines</h2><p className="section-subtitle">Key dates scoped to {project}</p></div><span className="count-badge">{projectMilestones.length}</span></div><div className="project-milestones-strip">{projectMilestones.map((milestone) => <article className={`project-milestone-card urgency-${milestoneUrgency(milestone)}`} key={milestone.id}><span className={`project-milestone-dot urgency-${milestoneUrgency(milestone)}`} /><div><strong>{milestone.name}</strong><span>{milestone.date} · {milestone.type} · {milestone.linkedCount} linked {milestone.linkedCount === 1 ? "task" : "tasks"}</span></div></article>)}{!projectMilestones.length && <p className="project-empty-copy">No milestones or deadlines are linked to this project yet.</p>}</div></section>
    <section className="project-open-section"><div className="section-title-row"><div><h2>Open tasks</h2><p className="section-subtitle">Active work in {project}</p></div><span className="count-badge">{projectTasks.length}</span></div><div className="register-table project-task-table"><div className="table-head"><span>Task</span><span>Project</span><span>Deadline</span><span>Owner</span><span>Effort</span><span /></div>{projectTasks.map((task) => <RegisterRow key={task.id} task={task} projectOptions={activeProjectNames(projects)} onDone={onDone} onClearBlocker={onClearBlocker} onUpdate={onUpdate} onCreateSubtasks={() => {}} hasDraftSubtasks={false} onEdit={onEdit} showSubtaskAction={false} />)}{!projectTasks.length && <EmptyState icon={ListChecks} title="No open tasks" copy="New active work for this project will appear here." />}</div></section>
    <section className="project-completed-section"><button className="project-completed-toggle" onClick={() => setCompletedOpen((value) => !value)} aria-expanded={completedOpen}><span><h2>Completed</h2><small>{projectCompleted.length} completed, {completedOpen ? "tap to collapse" : "tap to view"}</small></span><CaretDown size={20} className={completedOpen ? "rotated" : ""} /></button>{completedOpen && <div className="project-completed-table"><div className="project-completed-head"><span>Task</span><span>Completed</span><span>Score</span></div>{projectCompleted.map((item) => <div className="project-completed-row" key={item.id}><strong>{item.title}</strong><span>{item.date}</span><strong>{item.points ? `+${item.points} pts` : "No points"}</strong></div>)}{!projectCompleted.length && <p className="project-empty-copy">No completed tasks for this project yet.</p>}</div>}</section>
    <div className="project-score-footer"><div><span>Project contribution</span><strong>{projectScore} pts</strong></div><div className="project-score-track"><i style={{ width: `${Math.min(100, projectScore)}%` }} /></div></div>
    <section className="project-management-section"><div className="section-title-row"><div><h2>Projects</h2><p className="section-subtitle">Create projects and move them between active and finished.</p></div></div><form className="new-project-form" onSubmit={submitProject}><input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New project name" aria-label="New project name" /><button className="primary-button" type="submit" disabled={!newProjectName.trim()}><Plus size={17} /> Create project</button></form><div className="project-status-board"><ProjectStatusColumn status="active" title="Active projects" projects={activeProjects} onDragStart={setProjectDrag} onDrop={dropProject} onSelect={onProjectChange} /><ProjectStatusColumn status="finished" title="Finished projects" projects={finishedProjects} onDragStart={setProjectDrag} onDrop={dropProject} onSelect={onProjectChange} /></div></section>
  </section>;
}

function ProjectStatusColumn({ status, title, projects, onDragStart, onDrop, onSelect }) {
  return <div className="project-status-column" onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(status)}><div className="project-status-heading"><h3>{title}</h3><span>{projects.length}</span></div><div className="project-status-list">{projects.map((project) => <button className="project-status-item" type="button" draggable onDragStart={() => onDragStart(project)} onClick={() => onSelect(project.name)} key={project.name}><span>{project.name}</span><DotsSixVertical size={17} /></button>)}{!projects.length && <p className="project-status-empty">Drag projects here</p>}</div></div>;
}

function MilestonesView({ milestones, tasks, projects, onAdd, onUpdate, onDelete }) {
  const [view, setView] = useState("timeline");
  const [showPast, setShowPast] = useState(false);
  const [quickAdd, setQuickAdd] = useState({ name: "", date: "", project: projects[0] || "Unassigned" });
  const nameRef = useRef(null);
  const projectOptions = ["Unassigned", ...projects.filter((project) => project && project !== "Unassigned")];
  const enriched = useMemo(() => milestones.map((milestone) => ({ ...milestone, linkedCount: milestone.linkedTaskIds.filter((taskId) => tasks.some((task) => task.id === taskId)).length })), [milestones, tasks]);
  const [sort, setSort] = useState({ key: "dateKey", direction: "asc" });
  const sorted = useMemo(() => [...enriched].sort((left, right) => {
    if (sort.key === "linkedCount") return sort.direction === "asc" ? left.linkedCount - right.linkedCount : right.linkedCount - left.linkedCount;
    const leftValue = sort.key === "dateKey" ? left.dateKey || "9999-12-31" : String(left[sort.key] || "");
    const rightValue = sort.key === "dateKey" ? right.dateKey || "9999-12-31" : String(right[sort.key] || "");
    const comparison = leftValue.localeCompare(rightValue);
    return sort.direction === "asc" ? comparison : -comparison;
  }), [enriched, sort]);
  const [upcoming, past] = useMemo(() => {
    const today = todayKey();
    return [sorted.filter((milestone) => !milestone.dateKey || milestone.dateKey.slice(0, 10) >= today), sorted.filter((milestone) => milestone.dateKey && milestone.dateKey.slice(0, 10) < today)];
  }, [sorted]);
  const submit = (event) => {
    event.preventDefault();
    if (!quickAdd.name.trim() || !quickAdd.date) return;
    onAdd(quickAdd);
    setQuickAdd((current) => ({ ...current, name: "", date: "" }));
  };
  const toggleSort = (key) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  const renderItems = (items, emptyTitle, emptyCopy) => view === "timeline" ? <MilestoneTimeline milestones={items} projects={projectOptions} onUpdate={onUpdate} onDelete={onDelete} emptyTitle={emptyTitle} emptyCopy={emptyCopy} /> : <MilestoneList milestones={items} projects={projectOptions} sort={sort} onSort={toggleSort} onUpdate={onUpdate} onDelete={onDelete} emptyTitle={emptyTitle} emptyCopy={emptyCopy} />;
  return <section className="screen-content milestones-screen"><div className="milestones-toolbar"><div className="view-toggle" role="tablist" aria-label="Milestones view"><button className={view === "timeline" ? "selected" : ""} onClick={() => setView("timeline")} role="tab" aria-selected={view === "timeline"}>Timeline</button><button className={view === "list" ? "selected" : ""} onClick={() => setView("list")} role="tab" aria-selected={view === "list"}>List</button></div><button className="primary-button" onClick={() => nameRef.current?.focus()}><Plus size={18} weight="bold" /> Add milestone</button></div><form className="milestone-quick-add" onSubmit={submit}><div className="quick-add-label"><Plus size={17} /><span>Quick add</span></div><input ref={nameRef} value={quickAdd.name} onChange={(event) => setQuickAdd((current) => ({ ...current, name: event.target.value }))} placeholder="Milestone or deadline name" aria-label="Milestone or deadline name" /><input type="date" value={quickAdd.date} onChange={(event) => setQuickAdd((current) => ({ ...current, date: event.target.value }))} aria-label="Date" /><label className="quick-project-select"><span className="sr-only">Project</span><select value={quickAdd.project} onChange={(event) => setQuickAdd((current) => ({ ...current, project: event.target.value }))}>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select><CaretDown size={16} /></label><button className="secondary-button" type="submit" disabled={!quickAdd.name.trim() || !quickAdd.date}>Add</button></form>{renderItems(upcoming, "No upcoming milestones or deadlines", "Add one above to start planning ahead.")}{past.length > 0 && <section className="past-milestones"><button className="past-milestones-toggle" type="button" onClick={() => setShowPast((current) => !current)} aria-expanded={showPast}><span>Past events</span><span className="past-milestones-count">{past.length}</span><CaretDown className={showPast ? "expanded" : ""} size={18} /></button>{showPast && <div className="past-milestones-content">{renderItems(past, "", "")}</div>}</section>}</section>;
}

function MilestoneTimeline({ milestones, projects, onUpdate, onDelete, emptyTitle = "No milestones yet", emptyCopy = "Add one above to start your timeline." }) {
  return <div className="milestone-timeline">{milestones.map((milestone) => <MilestoneTimelineEntry key={milestone.id} milestone={milestone} projects={projects} onUpdate={onUpdate} onDelete={onDelete} />)}{!milestones.length && <EmptyState icon={CalendarBlank} title={emptyTitle} copy={emptyCopy} />}</div>;
}

function MilestoneTimelineEntry({ milestone, projects, onUpdate, onDelete }) {
  return <article className={`milestone-entry urgency-${milestoneUrgency(milestone)}`}><span className="milestone-dot" /><div className="milestone-date">{milestone.date}</div><MilestoneCard milestone={milestone} projects={projects} onUpdate={onUpdate} onDelete={onDelete} /></article>;
}

function MilestoneCard({ milestone, projects, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: milestone.name, dateKey: milestone.dateKey || "", project: milestone.project, type: milestone.type });
  useEffect(() => setDraft({ name: milestone.name, dateKey: milestone.dateKey || "", project: milestone.project, type: milestone.type }), [milestone]);
  const save = () => { if (!draft.name.trim()) return; onUpdate(milestone.id, draft); setEditing(false); };
  const remove = () => { if (window.confirm(`Delete \"${milestone.name}\"? This cannot be undone.`)) onDelete(milestone.id); };
  return <div className="milestone-card">{editing ? <div className="milestone-edit-grid"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} aria-label="Milestone name" /><input type="date" value={draft.dateKey} onChange={(event) => setDraft((current) => ({ ...current, dateKey: event.target.value }))} aria-label="Milestone date" /><select value={draft.project} onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))}>{projects.map((project) => <option key={project}>{project}</option>)}</select><select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option>Milestone</option><option>Deadline</option></select><div className="milestone-edit-actions"><button className="text-danger milestone-delete-button" type="button" onClick={remove}><Trash size={16} /> Delete</button><div className="milestone-edit-primary-actions"><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="button" onClick={save}>Save</button></div></div></div> : <><div className="milestone-card-top"><span className="milestone-type">{milestone.type}</span><button className="text-button milestone-edit-button" onClick={() => setEditing(true)}><PencilSimple size={14} /> Edit</button></div><h2>{milestone.name}</h2><div className="milestone-card-meta"><span>{milestone.project}</span><span>{milestone.linkedCount} linked {milestone.linkedCount === 1 ? "task" : "tasks"}</span></div></>}</div>;
}

function MilestoneList({ milestones, projects, sort, onSort, onUpdate, onDelete, emptyTitle = "No milestones yet", emptyCopy = "Add one above to start your list." }) {
  if (!milestones.length) return <EmptyState icon={CalendarBlank} title={emptyTitle} copy={emptyCopy} />;
  return <div className="milestone-list-wrap"><div className="milestone-list" role="table" aria-label="Milestones and deadlines"><div className="milestone-list-head" role="row"><SortHeader label="Date" sortKey="dateKey" sort={sort} onSort={onSort} /><SortHeader label="Name" sortKey="name" sort={sort} onSort={onSort} /><SortHeader label="Project" sortKey="project" sort={sort} onSort={onSort} /><SortHeader label="Type" sortKey="type" sort={sort} onSort={onSort} /><SortHeader label="Linked tasks" sortKey="linkedCount" sort={sort} onSort={onSort} /><span /></div>{milestones.map((milestone) => <MilestoneListRow milestone={milestone} projects={projects} onUpdate={onUpdate} onDelete={onDelete} key={milestone.id} />)}</div></div>;
}

function MilestoneListRow({ milestone, projects, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: milestone.name, dateKey: milestone.dateKey || "", project: milestone.project, type: milestone.type });
  const save = () => { if (!draft.name.trim()) return; onUpdate(milestone.id, draft); setEditing(false); };
  const remove = () => { if (window.confirm(`Delete \"${milestone.name}\"? This cannot be undone.`)) onDelete(milestone.id); };
  if (editing) return <div className="milestone-list-row milestone-list-edit-row"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} aria-label="Milestone name" /><input type="date" value={draft.dateKey} onChange={(event) => setDraft((current) => ({ ...current, dateKey: event.target.value }))} aria-label="Milestone date" /><select value={draft.project} onChange={(event) => setDraft((current) => ({ ...current, project: event.target.value }))}>{projects.map((project) => <option key={project}>{project}</option>)}</select><select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option>Milestone</option><option>Deadline</option></select><span>{milestone.linkedCount}</span><span className="milestone-row-actions"><button className="text-danger" type="button" onClick={remove}><Trash size={15} /> Delete</button><button className="text-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="text-button" type="button" onClick={save}>Save</button></span></div>;
  return <div className="milestone-list-row"><strong>{milestone.date}</strong><span>{milestone.name}</span><span>{milestone.project}</span><span className="milestone-type-cell">{milestone.type}</span><span>{milestone.linkedCount}</span><button className="text-button" onClick={() => setEditing(true)}><PencilSimple size={14} /> Edit</button></div>;
}

function urgencyLabel(milestone) {
  if (!milestone.linkedCount || !milestone.dateKey) return "quiet";
  const daysAway = Math.round((Date.parse(`${milestone.dateKey}T12:00:00`) - Date.parse(`${todayKey()}T12:00:00`)) / 86400000);
  if (daysAway <= 1) return "urgent";
  if (daysAway <= 7) return "approaching";
  if (daysAway <= 30) return "further";
  return "quiet";
}

function milestoneUrgency(milestone) { return urgencyLabel(milestone); }
function formatMilestoneDate(dateKey) { if (!dateKey) return "No date"; return new Date(`${dateKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
function activeProjectNames(projects) { return projects.filter((project) => project.status === "active").map((project) => project.name); }

function WorkRegister({ tasks, projects, projectFilter, setProjectFilter, newTaskRequest, onConsumeNewTaskRequest, onCreateTask, onDone, onClearBlocker, onUpdate, onCreateSubtask, onRefresh, onCreateRecurring, onEdit }) {
  const activeProjects = activeProjectNames(projects);
  const projectFilters = ["All projects", ...Array.from(new Set(tasks.map((task) => task.project).filter(Boolean)))];
  const [subtaskDrafts, setSubtaskDrafts] = useState({});
  const [newTaskDrafts, setNewTaskDrafts] = useState([]);
  const consumedNewTaskRequest = useRef(0);
  const [sort, setSort] = useState({ key: "deadlineKey", direction: "asc" });
  const [savedFilter, setSavedFilter] = useState("All tasks");
  const visible = useMemo(() => tasks.filter((task) => {
    if (projectFilter !== "All projects" && task.project !== projectFilter) return false;
    if (savedFilter === "My tasks") return /^ann$/i.test(String(task.owner || ""));
    if (savedFilter === "Due this week") return Boolean(task.deadlineKey && task.deadlineKey >= todayKey() && task.deadlineKey <= addDaysToKey(todayKey(), 7));
    if (savedFilter === "Needs details") return !task.deadlineKey || !task.owner || /^unassigned$/i.test(task.owner) || Number(task.effortHours || 0) === 0;
    return true;
  }).sort((left, right) => {
    const leftValue = sort.key === "effortHours" ? Number(left.effortHours || 0) : sort.key === "deadlineKey" ? left.deadlineKey || deadlineKeyFromLabel(left.deadline) || "9999-12-31" : String(left[sort.key] || "");
    const rightValue = sort.key === "effortHours" ? Number(right.effortHours || 0) : sort.key === "deadlineKey" ? right.deadlineKey || deadlineKeyFromLabel(right.deadline) || "9999-12-31" : String(right[sort.key] || "");
    const comparison = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue));
    return sort.direction === "asc" ? comparison : -comparison;
  }), [tasks, projectFilter, savedFilter, sort]);
  useEffect(() => {
    if (!newTaskRequest || newTaskRequest <= consumedNewTaskRequest.current) return;
    const rowsToAdd = newTaskRequest - consumedNewTaskRequest.current;
    consumedNewTaskRequest.current = newTaskRequest;
    setNewTaskDrafts((current) => Array.from({ length: rowsToAdd }, (_, index) => emptyTaskDraft(current.length + index)).reverse().concat(current));
    onConsumeNewTaskRequest();
  }, [newTaskRequest, onConsumeNewTaskRequest]);
  const createSubtasks = (task) => setSubtaskDrafts((current) => ({ ...current, [task.id]: current[task.id]?.length ? current[task.id] : buildSubtaskDrafts(task) }));
  const addSubtaskRow = (task) => setSubtaskDrafts((current) => ({ ...current, [task.id]: [...(current[task.id] || []), emptySubtaskDraft(task, (current[task.id] || []).length)] }));
  const updateSubtaskDraft = (parentId, draftId, field, value) => setSubtaskDrafts((current) => ({ ...current, [parentId]: (current[parentId] || []).map((draft) => draft.id === draftId ? { ...draft, [field]: value, ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value, draft.deadlineKey) } : {}) } : draft) }));
  const updateNewTaskDraft = (draftId, field, value) => setNewTaskDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, [field]: value, ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value, draft.deadlineKey) } : {}) } : draft));
  const saveSubtask = (parent, draft) => {
    onCreateSubtask(parent, draft);
    setSubtaskDrafts((current) => ({ ...current, [parent.id]: (current[parent.id] || []).filter((item) => item.id !== draft.id) }));
  };
  const saveNewTask = (draft) => {
    if (!draft.title.trim() || !draft.project.trim() || !Number(draft.effortHours)) return;
    onCreateTask(draft);
    setNewTaskDrafts((current) => current.filter((item) => item.id !== draft.id));
  };
  const toggleSort = (key) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  return <section className="screen-content"><div className="register-toolbar"><label className="project-filter"><span>Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>{projectFilters.map((project) => <option key={project} value={project}>{project}</option>)}</select><CaretDown size={17} /></label><div className="register-toolbar-actions"><button className="secondary-button" onClick={onCreateRecurring}><Clock size={18} /> Repeat weekly</button><button className="secondary-button sync-button" onClick={onRefresh}><ArrowClockwise size={18} /> Refresh</button></div></div><div className="saved-filter-row" aria-label="Saved work register filters">{["All tasks", "My tasks", "Due this week", "Needs details"].map((filter) => <button type="button" key={filter} className={`filter-pill ${savedFilter === filter ? "selected" : ""}`} onClick={() => setSavedFilter(filter)}>{filter}</button>)}</div><div className="register-table"><div className="table-head"><SortHeader label="Task" sortKey="title" sort={sort} onSort={toggleSort} /><SortHeader label="Project" sortKey="project" sort={sort} onSort={toggleSort} /><SortHeader label="Deadline" sortKey="deadlineKey" sort={sort} onSort={toggleSort} /><SortHeader label="Owner" sortKey="owner" sort={sort} onSort={toggleSort} /><SortHeader label="Effort" sortKey="effortHours" sort={sort} onSort={toggleSort} /><span /></div>{newTaskDrafts.map((draft) => <NewTaskRow key={draft.id} draft={draft} projectOptions={activeProjects} onChange={(field, value) => updateNewTaskDraft(draft.id, field, value)} onSave={() => saveNewTask(draft)} onCancel={() => setNewTaskDrafts((current) => current.filter((item) => item.id !== draft.id))} />)}{visible.map((task) => <Fragment key={task.id}><RegisterRow task={task} projectOptions={activeProjects} onDone={onDone} onClearBlocker={onClearBlocker} onUpdate={onUpdate} onCreateSubtasks={createSubtasks} hasDraftSubtasks={Boolean(subtaskDrafts[task.id]?.length)} onEdit={onEdit} />{(subtaskDrafts[task.id] || []).map((draft) => <DraftSubtaskRow key={draft.id} parent={task} draft={draft} projectOptions={activeProjects} onChange={(field, value) => updateSubtaskDraft(task.id, draft.id, field, value)} onSave={() => saveSubtask(task, draft)} />)}{subtaskDrafts[task.id]?.length > 0 && <div className="subtask-add-row"><button className="add-subtask-row-button" onClick={() => addSubtaskRow(task)}><Plus size={14} /> Add another subtask</button><span>Each row is saved independently</span></div>}</Fragment>)}{!visible.length && !newTaskDrafts.length && <EmptyState icon={ListChecks} title="No active work matches this filter" copy="Try another saved filter or add a task." />}</div></section>;
}

function NewTaskRow({ draft, projectOptions, onChange, onSave, onCancel }) {
  const canSave = draft.title.trim() && draft.project.trim() && Number(draft.effortHours) > 0;
  const update = (field, value) => onChange(field, value);
  return <div className="table-row new-task-row"><div className="task-cell register-edit-cell"><Plus size={18} className="new-task-indicator" /><input className="inline-input task-input" value={draft.title} placeholder="Task name" onChange={(event) => update("title", event.target.value)} aria-label="New task name" autoFocus /></div><label className="register-edit-cell" data-label="Project"><span className="sr-only">Project</span><select className="inline-input project-inline-select" value={draft.project} onChange={(event) => update("project", event.target.value)}><option value="">Select active project</option>{projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}</select></label><label className="register-edit-cell" data-label="Deadline"><span className="sr-only">Deadline</span><input className="inline-input" type="date" value={draft.deadlineKey || ""} onChange={(event) => update("deadline", event.target.value)} /></label><label className={`register-edit-cell ${!draft.owner || /^unassigned$/i.test(draft.owner) ? "unassigned-owner" : ""}`} data-label="Owner"><span className="sr-only">Owner</span><input className="inline-input" value={draft.owner} placeholder="Owner" onChange={(event) => update("owner", event.target.value)} /></label><label className={`register-edit-cell ${Number(draft.effortHours || 0) === 0 ? "zero-effort" : ""}`} data-label="Effort"><span className="sr-only">Effort</span><input className="inline-input effort-input" type="number" min="0.25" step="0.25" inputMode="decimal" value={draft.effortHours} placeholder="Hours" onChange={(event) => update("effortHours", event.target.value)} /></label><div className="register-row-actions"><button className="secondary-button cancel-new-task-button" onClick={onCancel}>Cancel</button><button className="save-row-button" disabled={!canSave} onClick={onSave}>Save</button></div></div>;
}

function RegisterRow({ task, projectOptions, onDone, onClearBlocker, onUpdate, onCreateSubtasks, hasDraftSubtasks, onEdit, showSubtaskAction = true }) {
  const [draft, setDraft] = useState(() => registerDraft(task));
  useEffect(() => setDraft(registerDraft(task)), [task]);
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value, ...(field === "deadline" ? { deadlineKey: deadlineKeyFromLabel(value) } : {}) }));
  const changed = ["title", "project", "deadline", "owner", "effortHours"].some((field) => String(draft[field] ?? "") !== String(registerDraft(task)[field] ?? ""));
  const dueToday = Boolean(draft.deadlineKey && draft.deadlineKey <= todayKey());
  const overdue = Boolean(draft.deadlineKey && draft.deadlineKey < todayKey());
  const save = () => onUpdate(task.id, draft);
  return <div className={`table-row ${task.status === "blocked" ? "blocked-row" : ""}`}><div className="task-cell register-edit-cell">{dueToday && <Warning size={20} className="red-icon" />}{task.status === "blocked" && <span className="blocked-indicator"><Warning size={19} /></span>}<input className="inline-input task-input" value={draft.title} onChange={(event) => update("title", event.target.value)} aria-label={`Task name for ${task.title}`} />{task.recurring && <span className="recurring-label">Weekly</span>}{task.blocker && <small>{task.blocker}</small>}<button className="row-edit-details" onClick={() => onEdit(task)} aria-label={`Open full details for ${task.title}`}><PencilSimple size={14} /></button></div><label className="register-edit-cell" data-label="Project"><span className="sr-only">Project</span><select className="inline-input project-inline-select" value={draft.project} onChange={(event) => update("project", event.target.value)}>{projectOptions.includes(draft.project) || !draft.project ? <option value="">{draft.project || "Select active project"}</option> : <option value={draft.project}>{draft.project} · Finished</option>}{projectOptions.filter((project) => project !== draft.project).map((project) => <option key={project} value={project}>{project}</option>)}</select></label><label className={`register-edit-cell ${dueToday ? "due-today" : !draft.deadlineKey ? "no-deadline" : ""}`} data-label="Deadline"><span className="sr-only">Deadline</span><input className="inline-input" type="date" value={draft.deadlineKey || ""} onChange={(event) => update("deadline", event.target.value)} /></label><label className={`register-edit-cell ${!draft.owner || /^unassigned$/i.test(draft.owner) ? "unassigned-owner" : ""}`} data-label="Owner"><span className="sr-only">Owner</span><input className="inline-input" value={draft.owner} onChange={(event) => update("owner", event.target.value)} /></label><label className={`register-edit-cell ${Number(draft.effortHours || 0) === 0 ? "zero-effort" : ""}`} data-label="Effort"><span className="sr-only">Effort</span><input className="inline-input effort-input" type="number" min="0.25" step="0.25" inputMode="decimal" value={draft.effortHours} onChange={(event) => update("effortHours", event.target.value)} /></label><div className="register-row-actions">{showSubtaskAction && Number(draft.effortHours) > 1 && <button className="subtask-button" onClick={() => onCreateSubtasks({ ...task, ...draft })}><Sparkle size={15} /> {hasDraftSubtasks ? "Regenerate subtasks" : "Create subtasks"}</button>}{changed && <button className="save-row-button" onClick={save}>Save</button>}<button className="row-action" onClick={() => task.status === "blocked" ? onClearBlocker(task) : onDone(task)}>{task.status === "blocked" ? "Clear blocker" : "Mark done"}</button></div></div>;
}

function DraftSubtaskRow({ parent, draft, projectOptions, onChange, onSave }) {
  return <div className="table-row draft-subtask-row"><div className="task-cell register-edit-cell"><ArrowRight size={15} className="subtask-indent" /><input className="inline-input task-input" value={draft.title} placeholder="Add a subtask" onChange={(event) => onChange("title", event.target.value)} aria-label={`Draft subtask name for ${parent.title}`} />{draft.aiSuggested && <span className="ai-draft-label">AI suggested</span>}</div><label className="register-edit-cell" data-label="Project"><span className="sr-only">Project</span><select className="inline-input project-inline-select" value={draft.project} onChange={(event) => onChange("project", event.target.value)}><option value="">Select active project</option>{projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}</select></label><label className="register-edit-cell" data-label="Deadline"><span className="sr-only">Deadline</span><input className="inline-input" type="date" value={draft.deadlineKey || ""} onChange={(event) => onChange("deadline", event.target.value)} /></label><label className="register-edit-cell" data-label="Owner"><span className="sr-only">Owner</span><input className="inline-input" value={draft.owner} placeholder="Owner" onChange={(event) => onChange("owner", event.target.value)} /></label><label className="register-edit-cell" data-label="Effort"><span className="sr-only">Effort</span><input className="inline-input effort-input" type="number" min="0.25" step="0.25" inputMode="decimal" value={draft.effortHours} placeholder="Hours" onChange={(event) => onChange("effortHours", event.target.value)} /></label><div className="register-row-actions"><button className="save-row-button" disabled={!draft.title.trim()} onClick={onSave}>Save</button></div></div>;
}

function CompletedView({ completed, scoreEvents = [], tasks, period, setPeriod, onUndo }) {
  const history = scoreEvents.length ? scoreEvents : completed.map((item) => ({ date: item.date, amount: item.points }));
  const periodDays = period === "Last 30 days" ? 30 : 7;
  const chartDays = Array.from({ length: periodDays }, (_, index) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (periodDays - 1 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, day: date.toLocaleDateString("en-US", { weekday: "short" }), label: periodDays === 30 ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : date.toLocaleDateString("en-US", { weekday: "short" }) };
  });
  const rangeStart = chartDays[0].key;
  const inPeriod = (dateKey) => Boolean(dateKey && dateKey >= rangeStart && dateKey <= todayKey());
  const scoreHistory = history.filter((item) => inPeriod(item.dateKey));
  const completedInPeriod = completed.filter((item) => inPeriod(item.dateKey));
  const total = scoreHistory.reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0);
  const carryover = tasks.filter((task) => task.status === "active" && task.deadlineKey && task.deadlineKey < rangeStart).length;
  const bars = chartDays.map((day) => ({ ...day, value: scoreHistory.filter((item) => item.dateKey === day.key).reduce((sum, item) => sum + Number(item.amount || item.points || 0), 0) }));
  const max = Math.max(...bars.map((bar) => bar.value), 40);
  const [sort, setSort] = useState({ key: "createdAt", direction: "desc" });
  const [activeBar, setActiveBar] = useState(null);
  const activity = useMemo(() => [
    ...completed.map((item) => ({ ...item, activity: "Completed", canUndo: true })),
    ...scoreEvents.filter((item) => item.cause === "task added").map((item) => ({ id: `score-${item.id}`, title: item.title || "Task", project: item.project || "Unassigned", date: item.date, dateKey: item.dateKey, createdAt: item.createdAt, points: item.amount, activity: "Task added", canUndo: false })),
  ], [completed, scoreEvents]);
  const sortedActivity = useMemo(() => [...activity].sort((a, b) => {
    const getValue = (item) => sort.key === "createdAt" ? Date.parse(item.createdAt || item.dateKey || 0) : sort.key === "date" ? item.dateKey || Date.parse(`${item.date} 2026`) || 0 : sort.key === "points" ? Number(item.points) : String(item[sort.key] || "");
    const left = getValue(a); const right = getValue(b);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sort.direction === "asc" ? comparison : -comparison;
  }), [activity, sort]);
  const toggleSort = (key) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
  return <section className="screen-content completed-screen"><div className="period-toolbar"><div><p className="eyebrow">Your private score history</p><h2 className="period-title">{period}</h2></div><label className="select-wrap"><span className="sr-only">Summary period</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option>Last 7 days</option><option>Last 30 days</option></select><CaretDown size={17} /></label></div><div className="metric-grid"><Metric label="Period score" value={`${total} pts`} icon={Sparkle} /><Metric label="Tasks completed" value={`${completedInPeriod.length} tasks`} icon={CheckCircle} /><Metric label="Carryover into period" value={`${carryover} tasks`} icon={StackSimple} /></div><div className="chart-section"><h2>Score by day</h2><div className={`bar-chart bar-chart-${periodDays}`} aria-label={`Score by day for the ${period.toLowerCase()}`}>{bars.map((bar) => { const height = bar.value ? Math.max(10, (bar.value / max) * 100) : 0; const isActive = activeBar === bar.key; return <div className="bar-column" key={bar.key}><div className="bar-track"><button type="button" className={`bar-hit ${isActive ? "active" : ""}`} style={{ "--bar-height": `${height}%` }} onMouseEnter={() => setActiveBar(bar.key)} onMouseLeave={() => setActiveBar(null)} onFocus={() => setActiveBar(bar.key)} onBlur={() => setActiveBar(null)} onClick={() => setActiveBar((current) => current === bar.key ? null : bar.key)} aria-label={`${bar.label}: ${bar.value} points`} aria-pressed={isActive}>{isActive && <span className="bar-tooltip" role="tooltip">{bar.value} {bar.value === 1 ? "point" : "points"}</span>}<span className="bar" style={{ height: `${height}%` }} /></button></div><span>{bar.label}</span></div>; })}</div></div><div className="completed-section"><div className="section-title-row"><h2>Task activity</h2></div><div className="completed-table-wrap"><div className="completed-table completed-activity-table" role="table" aria-label="Task score activity"><div className="completed-table-head" role="row"><SortHeader label="Task" sortKey="title" sort={sort} onSort={toggleSort} /><SortHeader label="Project" sortKey="project" sort={sort} onSort={toggleSort} /><SortHeader label="Activity" sortKey="activity" sort={sort} onSort={toggleSort} /><SortHeader label="Date" sortKey="date" sort={sort} onSort={toggleSort} /><SortHeader label="Score" sortKey="points" sort={sort} onSort={toggleSort} /><span /></div>{sortedActivity.map((item) => <div className="completed-table-row" role="row" key={item.id}><strong>{item.title}</strong><span>{item.project}</span><span className="score-activity-label">{item.activity}</span><span>{item.date}</span><strong>{item.points ? `+${item.points} pts` : "No points"}</strong>{item.canUndo ? <button className="secondary-button undone-button" onClick={() => onUndo(item)}>Mark undone</button> : <span />}</div>)}{!sortedActivity.length && <EmptyState icon={CheckCircle} title="No task activity" copy="Completed work and new tasks will appear here." />}</div></div></div></section>;
}

function SortHeader({ label, sortKey, sort, onSort }) { const active = sort.key === sortKey; return <button className={`sortable-header ${active ? "active" : ""}`} onClick={() => onSort(sortKey)} aria-label={`Sort by ${label}`} aria-sort={active ? sort.direction : "none"}>{label}{active ? sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : <ArrowsDownUp size={13} />}</button>; }

function Metric({ label, value, icon: Icon }) { return <div className="metric-card"><div className="metric-label"><Icon size={19} /> {label}</div><strong>{value}</strong></div>; }

function Modal({ modal, onClose, onApprove, onDismiss, onNotice, onNewTask, onCreateRecurring, onUpdateTask, projectOptions }) {
  if (modal.type === "reorder") return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-panel small-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button><div className="modal-icon"><SlidersHorizontal size={21} /></div><h2>Reorder your plan</h2><p>Workboard can suggest a new order using deadlines and your available calendar time. You stay in control.</p><button className="primary-button full-button" onClick={() => { onClose(); onNotice("Plan reordered around today's open time"); }}>Apply suggested order</button></div></div>;
  if (modal.type === "new-task") return <TaskForm title="Add a task" subtitle="Create a task directly in your work register." projectOptions={projectOptions} onClose={onClose} onSave={onNewTask} />;
  if (modal.type === "recurring-task") return <RecurringTaskForm projectOptions={projectOptions} onClose={onClose} onSave={onCreateRecurring} />;
  if (modal.type === "task-edit") return <TaskForm title="Edit task details" subtitle="Update the task or add context." item={modal.task} projectOptions={projectOptions} onClose={onClose} onSave={(values) => onUpdateTask(modal.task.id, values)} />;
  const item = modal.item;
  const isMilestone = item?.itemKind === "MILESTONE";
  return <TaskForm title={modal.type === "fill" ? `Fill in ${isMilestone ? "milestone" : "task"} details` : `Edit ${isMilestone ? "milestone" : "draft"}`} subtitle={modal.type === "fill" ? `Add the missing fields before this ${isMilestone ? "milestone" : "draft"} can be approved.` : "Review the AI first pass before approving."} item={item} projectOptions={projectOptions} onClose={onClose} onSave={(values) => onApprove(item, values)} onReject={() => onDismiss(item.id)} showReject={modal.type === "edit"} />;
}


function TaskForm({ title, subtitle, item, projectOptions = [], onClose, onSave, onReject, showReject }) {
  const isMilestone = item?.itemKind === "MILESTONE";
  const [values, setValues] = useState({ title: item?.title || "", project: item?.project || "", effortHours: item?.effortHours || "", deadline: calendarDateValue(item?.deadline, item?.deadlineKey), owner: item?.owner || "Unassigned", notes: item?.notes || "", notesAi: item?.notesAi || false, itemKind: item?.itemKind || "TASK", milestoneType: item?.milestoneType || "Milestone" });
  const projectChoices = [...new Set([...projectOptions, item?.project].filter(Boolean))];
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const isEdit = Boolean(item?.status);
  const valid = isMilestone ? values.title && values.project && values.deadline : values.title && values.project && values.effortHours && Number(values.effortHours) > 0;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-panel task-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button><div className="modal-icon"><NotePencil size={21} /></div><h2>{title}</h2><p>{subtitle}</p><div className="form-grid"><label>{isMilestone ? "Name" : "Task description"}<input value={values.title} onChange={(event) => update("title", event.target.value)} autoFocus /></label><label>Project<select value={values.project} onChange={(event) => update("project", event.target.value)}><option value="">Select active project</option>{projectChoices.map((project) => <option key={project} value={project}>{project}{item?.project === project && !projectOptions.includes(project) ? " · Finished" : ""}</option>)}</select></label>{isMilestone ? <><label>Target date<input type="date" value={values.deadline} onChange={(event) => update("deadline", event.target.value)} /></label><label>Type<select value={values.milestoneType} onChange={(event) => update("milestoneType", event.target.value)}><option>Milestone</option><option>Deadline</option></select></label></> : <><label>Effort estimate (hours)<input type="number" min="0.25" step="0.25" inputMode="decimal" value={values.effortHours} onChange={(event) => update("effortHours", event.target.value)} placeholder="e.g. 1.5" /></label><label>Owner<input value={values.owner} onChange={(event) => update("owner", event.target.value)} /></label><label>Deadline<input type="date" value={values.deadline} onChange={(event) => update("deadline", event.target.value)} /></label></>}</div>{!isMilestone && <div className="notes-field"><div className="notes-label-row"><label>Notes<textarea value={values.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Add context, links, decisions, or next steps..." /></label><span className="ai-note-badge">{values.notesAi ? "AI populated" : "Owner notes"}</span></div></div>}<div className="modal-footer">{showReject && <button className="text-danger" onClick={onReject}><Trash size={17} /> Reject draft</button>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid} onClick={() => onSave(values)}>{isEdit ? "Save changes" : showReject ? `Save and approve${isMilestone ? " milestone" : ""}` : isMilestone ? "Add milestone" : "Activate task"}</button></div></div></div></div>;
}

function RecurringTaskForm({ projectOptions = [], onClose, onSave }) {
  const presets = {
    "Weekly review": { title: "Weekly review", effortHours: "1", weekday: "5" },
    "Status update": { title: "Prepare weekly status update", effortHours: "0.5", weekday: "5" },
    "Administrative work": { title: "Weekly administrative work", effortHours: "1", weekday: "4" },
  };
  const [values, setValues] = useState({ title: "", project: "", owner: "Ann", effortHours: "1", weekday: "5" });
  const update = (field, value) => setValues((current) => ({ ...current, [field]: value }));
  const applyPreset = (preset) => setValues((current) => ({ ...current, ...presets[preset] }));
  const valid = values.title.trim() && values.project && values.owner.trim() && Number(values.effortHours) > 0;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-panel task-modal recurring-task-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button><div className="modal-icon"><Clock size={21} /></div><h2>Repeat a weekly task</h2><p>Create a task now and automatically add the next occurrence when you mark it done.</p><div className="recurring-presets" aria-label="Suggested recurring tasks">{Object.keys(presets).map((preset) => <button type="button" key={preset} onClick={() => applyPreset(preset)}>{preset}</button>)}</div><div className="form-grid"><label>Task description<input value={values.title} onChange={(event) => update("title", event.target.value)} autoFocus /></label><label>Project<select value={values.project} onChange={(event) => update("project", event.target.value)}><option value="">Select active project</option>{projectOptions.map((project) => <option key={project}>{project}</option>)}</select></label><label>Owner<input value={values.owner} onChange={(event) => update("owner", event.target.value)} /></label><label>Effort estimate (hours)<input type="number" min="0.25" step="0.25" inputMode="decimal" value={values.effortHours} onChange={(event) => update("effortHours", event.target.value)} /></label><label>Due every<select value={values.weekday} onChange={(event) => update("weekday", event.target.value)}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label></div><div className="modal-footer"><span className="recurring-note">Creates the first occurrence immediately.</span><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!valid} onClick={() => onSave(values)}><Clock size={17} /> Create weekly task</button></div></div></div></div>;
}

function EmptyState({ icon: Icon, title, copy }) { return <div className="empty-state"><Icon size={28} /><h2>{title}</h2><p>{copy}</p></div>; }
function registerDraft(task) {
  return { title: task.title, project: task.project, deadline: task.deadline, deadlineKey: task.deadlineKey, owner: task.owner, effortHours: task.effortHours };
}
function emptyTaskDraft(index = 0) {
  return { id: `new-task-row-${Date.now()}-${index}`, title: "", project: "", deadline: "", deadlineKey: null, owner: "", effortHours: "" };
}
function addDaysToKey(dateKey, days) { const date = new Date(`${dateKey}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function buildSubtaskDrafts(task) {
  const effort = Math.max(0.25, Number(task.effortHours) || 1);
  const firstEffort = Math.max(0.25, Math.round((effort * 0.35) * 4) / 4);
  const secondEffort = Math.max(0.25, Math.round((effort * 0.4) * 4) / 4);
  return [{ id: `${task.id}-subtask-a`, title: `Gather inputs for ${task.title}`, project: task.project, deadline: task.deadline, deadlineKey: task.deadlineKey, owner: task.owner, effortHours: firstEffort, aiSuggested: true }, { id: `${task.id}-subtask-b`, title: `Complete the first pass of ${task.title}`, project: task.project, deadline: task.deadline, deadlineKey: task.deadlineKey, owner: task.owner, effortHours: secondEffort, aiSuggested: true }, emptySubtaskDraft(task, 2)];
}
function emptySubtaskDraft(task, index) {
  return { id: `${task.id}-subtask-new-${Date.now()}-${index}`, title: "", project: "", deadline: "", deadlineKey: null, owner: "", effortHours: "", aiSuggested: false };
}
function deadlineKeyFromLabel(value, fallback = null) {
  if (!value || value === "No deadline") return null;
  if (value === "Today") return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(`${value} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString().slice(0, 10);
}
function calendarDateValue(value, dateKey) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return dateKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return value;
  return deadlineKeyFromLabel(value) || "";
}
function Confetti({ points }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const density = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let frameId;
    let lastTime = null;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * density;
      canvas.height = height * density;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    resize();
    const pieces = Array.from({ length: 140 }, (_, index) => ({ x: width / 2 + (Math.random() - 0.5) * 18, y: height / 2 + (Math.random() - 0.5) * 18, size: 5 + Math.random() * 6, vx: (Math.random() - 0.5) * Math.max(240, width * 0.55), vy: (Math.random() - 0.5) * Math.max(240, height * 0.55), gravity: 180 + Math.random() * 160, rotation: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 8, color: ["#ff2d55", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#0a84ff", "#af52de"][index % 7], life: 1 }));
    const render = (timestamp) => {
      const delta = lastTime === null ? 0 : Math.min((timestamp - lastTime) / 1000, 0.033);
      lastTime = timestamp;
      context.clearRect(0, 0, width, height);
      let visible = false;
      pieces.forEach((piece) => {
        piece.x += piece.vx * delta;
        piece.y += piece.vy * delta;
        piece.vy += piece.gravity * delta;
        piece.rotation += piece.spin * delta;
        piece.life -= delta / 3.2;
        if (piece.y < height + 20 && piece.life > 0) visible = true;
        context.save();
        context.globalAlpha = Math.max(0, piece.life);
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 1.8);
        context.restore();
      });
      if (visible) frameId = window.requestAnimationFrame(render);
    };
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(render);
    return () => { window.cancelAnimationFrame(frameId); window.removeEventListener("resize", resize); context.clearRect(0, 0, width, height); };
  }, []);
  return <><canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />{points !== null && points !== undefined && <div className="confetti-points" aria-live="polite">+{points}</div>}</>;
}
function effortPoints(hours) { if (Number(hours) >= 4) return 40; if (Number(hours) > 1) return 20; return 10; }
function isAnnOwner(owner) { return String(owner || "").trim().toLowerCase() === "ann"; }
function effortLabel(hours) { const value = Number(hours); if (!value) return "No estimate"; return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")} hr${value === 1 ? "" : "s"}`; }
export { App };
