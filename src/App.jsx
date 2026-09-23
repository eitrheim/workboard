import { useEffect, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  Briefcase,
  CalendarBlank,
  CheckCircle,
  Clock,
  FileArrowUp,
  House,
  ListChecks,
  MagnifyingGlass,
  Plus,
  Sparkle,
} from "@phosphor-icons/react";
import { backendApi } from "./api";
import { isAnnOwner, normalizeMilestone, todayLongLabel } from "./features/utils.js";
import { extractedTaskOwner, TaskExtraction } from "./features/extraction.jsx";
import {
  NavButton,
  Overview,
  ReviewQueue,
  ProjectView,
  MilestonesView,
  WorkRegister,
  CompletedView,
  activeProjectNames,
} from "./features/views.jsx";
import { Modal } from "./features/forms.jsx";
import { Confetti } from "./features/feedback.jsx";

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
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const applyLiveState = (state) => {
    const liveTasks = state?.tasks || [];
    setQueue(state?.queue || []);
    setTasks(liveTasks);
    setMilestones((state?.milestones || []).map(normalizeMilestone));
    setCompleted(state?.completed || []);
    setScoreEvents(state?.scoreEvents || []);
    setProjects(state?.projects || []);
    if (!selectedProject) {
      const firstProject =
        (state?.projects || []).find((project) => project.status === "active")?.name ||
        liveTasks.find((task) => task.project)?.project ||
        state?.completed?.find((item) => item.project)?.project ||
        "";
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
        showNotice(
          `${importedTasks.length} new ${importedTasks.length === 1 ? "task was" : "tasks were"} imported from Smartsheet. +${importedTasks.length} point${importedTasks.length === 1 ? "" : "s"} added`,
        );
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
    const loadBackendState = () =>
      backendApi
        .state()
        .then((state) => {
          if (active) {
            applyLiveState(state);
            setLoadError("");
            setLoading(false);
          }
        })
        .catch((error) => {
          if (active) {
            setLoadError(error.message || "Could not load your saved Workboard data");
            setLoading(false);
          }
        });
    loadBackendState();
    return () => {
      active = false;
    };
    // Load once on mount; applyLiveState intentionally closes over the current project selection.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retryLoad = async () => {
    setLoading(true);
    setLoadError("");
    try {
      await refreshLiveState();
    } catch (error) {
      setLoadError(error.message || "Could not load your saved Workboard data");
    } finally {
      setLoading(false);
    }
  };

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const sendExtractedToQueue = async (items, fileName, navigate = true) => {
    const entries = items.map((item, index) => {
      const isMilestone = item.type === "MILESTONE";
      const owner = isMilestone ? item.owner || "" : extractedTaskOwner(item.owner);
      return {
        id: item.sourceItemId ? `${item.sourceItemId}:${item.extractedIndex}` : `file-draft-${Date.now()}-${index}`,
        sourceItemId: item.sourceItemId,
        extractedIndex: item.extractedIndex,
        type: "draft",
        itemKind: isMilestone ? "MILESTONE" : "TASK",
        source: `Dropped file · ${fileName}`,
        sourceKind: "file",
        title: item.title,
        project: item.project || "",
        owner,
        deadline: item.dateLabel || "",
        deadlineKey: item.dateKey || null,
        effortHours: item.effortHours || 1,
        notes: item.evidence || "",
        notesAi: Boolean(item.evidence),
        badge: "AI drafted",
        detail: `${isMilestone ? "Milestone" : "Task"}${isMilestone ? "" : ` · ${owner}`} · ${item.dateLabel || "Date unclear"}`,
      };
    });
    if (items.every((item) => item.sourceItemId)) {
      try {
        await refreshLiveState();
      } catch {
        setQueue((current) => [
          ...entries.filter((entry) => !current.some((queued) => queued.id === entry.id)),
          ...current,
        ]);
      }
    } else {
      setQueue((current) => [
        ...entries.filter((entry) => !current.some((queued) => queued.id === entry.id)),
        ...current,
      ]);
    }
    if (navigate) setScreen("review");
    showNotice(
      `${entries.length} extracted ${entries.length === 1 ? "item was" : "items were"} sent to the review queue`,
    );
  };

  const approveDraft = async (item, values = item) => {
    try {
      const isMilestone = item.itemKind === "MILESTONE";
      let result;
      if (item.sourceItemId)
        result = await backendApi.approveSourceItem(item.sourceItemId, item.extractedIndex, values);
      else if (isMilestone)
        result = await backendApi.createMilestone({
          name: values.title,
          date: values.deadline,
          project: values.project,
          type: values.milestoneType,
        });
      else result = await backendApi.createTask(values);
      await refreshLiveState();
      setModal(null);
      setCelebration({ id: Date.now(), points: isMilestone ? null : 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice(
        result?.syncWarning ||
          (isMilestone
            ? "Milestone approved and added to Milestones & deadlines"
            : "Task approved and added to your work register. +1 point added"),
      );
    } catch (error) {
      showNotice(error.message || "Approval failed");
    }
  };

  const dismissQueueItem = async (id, item = queue.find((entry) => entry.id === id)) => {
    try {
      if (item?.sourceItemId) await backendApi.dismissSourceItem(item.sourceItemId, item.extractedIndex);
      await refreshLiveState();
      setModal(null);
      showNotice("Removed from the review queue");
    } catch (error) {
      showNotice(error.message || "Could not remove the item");
    }
  };

  const markDone = async (task) => {
    if (task.status === "blocked") return;
    try {
      const result = await backendApi.completeTask(task.id);
      await refreshLiveState();
      const points = isAnnOwner(task.owner) ? task.points : null;
      setCelebration({ id: Date.now(), points });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice(
        result?.syncWarning ||
          (points ? `Completed. +${points} points added` : "Completed. No points awarded because Ann is not the owner"),
      );
    } catch (error) {
      showNotice(error.message || "Could not complete the task");
    }
  };

  const clearBlocker = async (task) => {
    try {
      await backendApi.updateTask(task.id, { ...task, deadline: task.deadline, status: "active", blocker: "" });
      await refreshLiveState();
      showNotice("Blocker cleared");
    } catch (error) {
      showNotice(error.message || "Could not clear blocker");
    }
  };
  const undoCompleted = async (item) => {
    try {
      await backendApi.undoCompleted(item.id);
      await refreshLiveState();
      setScreen("register");
      showNotice("Task marked undone and returned to the Work register");
    } catch (error) {
      showNotice(error.message || "Could not mark task undone");
    }
  };
  const applyCreatedTask = (result) => {
    const task = result?.task || result;
    if (task?.id) setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
    if (result?.scoreEvent?.id)
      setScoreEvents((current) => [result.scoreEvent, ...current.filter((item) => item.id !== result.scoreEvent.id)]);
  };
  const createTask = async (values) => {
    try {
      const result = await backendApi.createTask(values);
      applyCreatedTask(result);
      refreshLiveState().catch(() => {});
      setModal(null);
      setCelebration({ id: Date.now(), points: 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice(result?.syncWarning || "New task added to your work register. +1 point added");
    } catch (error) {
      showNotice(error.message || "Could not create the task");
    }
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
    } catch (error) {
      showNotice(error.message || "Could not create recurring task");
    }
  };

  const createProject = async (name) => {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return;
    const optimisticProject = { id: `local-project-${Date.now()}`, name: trimmedName, status: "active" };
    setProjects((current) =>
      current.some((project) => project.name.toLowerCase() === trimmedName.toLowerCase())
        ? current
        : [...current, optimisticProject],
    );
    setSelectedProject(trimmedName);
    try {
      const savedProject = await backendApi.createProject(trimmedName);
      setProjects((current) => current.map((project) => (project.name === trimmedName ? savedProject : project)));
      await refreshLiveState();
      showNotice("Project created and added to active projects");
    } catch {
      showNotice("Project added locally; persistence is unavailable");
    }
  };

  const updateProjectStatus = async (name, status) => {
    try {
      await backendApi.updateProjectStatus(name, status);
      await refreshLiveState();
      if (status === "finished" && selectedProject === name) setSelectedProject("");
      showNotice(status === "finished" ? "Project moved to finished" : "Project restored to active");
    } catch (error) {
      showNotice(error.message || "Could not update project");
    }
  };

  const updateTask = async (taskId, values) => {
    try {
      const updatedTask = await backendApi.updateTask(taskId, values);
      setTasks((current) => current.map((task) => (task.id === taskId ? updatedTask : task)));
      setModal(null);
      showNotice(updatedTask?.syncWarning || "Task details updated");
    } catch (error) {
      showNotice(error.message || "Could not update the task");
    }
  };
  const deleteTask = async (task) => {
    try {
      await backendApi.deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setModal(null);
      showNotice("Task removed from Workboard");
    } catch (error) {
      showNotice(error.message || "Could not remove the task");
    }
  };

  const createSubtask = async (parentTask, values) => {
    try {
      const result = await backendApi.createTask({
        ...values,
        parentTaskId: parentTask.id,
        notes: `AI suggested subtask for ${parentTask.title}`,
        notesAi: true,
      });
      applyCreatedTask(result);
      refreshLiveState().catch(() => {});
      setCelebration({ id: Date.now(), points: 1 });
      window.setTimeout(() => setCelebration(null), 2300);
      showNotice("Subtask saved and added to the Work register. +1 point added");
    } catch (error) {
      showNotice(error.message || "Could not save subtask");
    }
  };

  const addMilestone = async (values) => {
    try {
      const milestone = await backendApi.createMilestone(values);
      setMilestones((current) => [...current, normalizeMilestone(milestone)]);
      showNotice("Milestone added");
    } catch (error) {
      showNotice(error.message || "Could not add milestone");
    }
  };
  const updateMilestone = async (milestoneId, values) => {
    try {
      const milestone = await backendApi.updateMilestone(milestoneId, values);
      setMilestones((current) =>
        current.map((item) => (item.id === milestoneId ? normalizeMilestone(milestone) : item)),
      );
      showNotice("Milestone updated");
    } catch (error) {
      showNotice(error.message || "Could not update milestone");
    }
  };
  const deleteMilestone = async (milestoneId) => {
    try {
      await backendApi.deleteMilestone(milestoneId);
      setMilestones((current) => current.filter((item) => item.id !== milestoneId));
      showNotice("Milestone deleted");
    } catch (error) {
      showNotice(error.message || "Could not delete milestone");
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkle size={18} weight="fill" />
          </div>
          <div>
            <strong>Workboard</strong>
            <span>Personal operations</span>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              count={item.id === "review" ? queue.length : item.count}
              active={screen === item.id}
              onClick={() => setScreen(item.id)}
            />
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="source-status">
            <span className="status-dot" /> Private hosted app
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="mobile-header">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Sparkle size={17} weight="fill" />
            </div>
            <strong>Workboard</strong>
          </div>
          <button
            className="icon-button"
            aria-label="Search"
            onClick={() => showNotice("Search is ready for your task list")}
          >
            <MagnifyingGlass size={20} />
          </button>
        </header>
        <main className="content">
          {loading && (
            <section className="data-state-panel" aria-live="polite">
              <div className="loading-spinner" aria-hidden="true" />
              <h2>Loading your Workboard</h2>
              <p>Fetching your saved tasks and milestones.</p>
            </section>
          )}
          {!loading && loadError && (
            <section className="data-state-panel data-state-error" role="alert">
              <h2>We couldn’t load your Workboard data</h2>
              <p>{loadError}</p>
              <button className="primary-button" onClick={retryLoad} type="button">
                Try again
              </button>
            </section>
          )}
          {!["milestones", "project"].includes(screen) && (
            <div className={`content-heading ${screen === "register" ? "register-heading" : ""}`}>
              <div>
                <p className="eyebrow">{todayLongLabel()}</p>
                <h1>{navItems.find((item) => item.id === screen)?.label}</h1>
              </div>
              <div className="heading-actions">
                {screen === "register" ? (
                  <>
                    <button
                      className="secondary-button register-header-action"
                      onClick={refreshRegister}
                      disabled={refreshing}
                    >
                      <ArrowClockwise size={17} /> {refreshing ? "Refreshing" : "Refresh"}
                    </button>
                    <button
                      className="secondary-button register-header-action"
                      onClick={() => setModal({ type: "recurring-task" })}
                    >
                      <Clock size={17} /> New repeat task
                    </button>
                    <button
                      className="primary-button new-task-button"
                      onClick={() => setNewTaskRequest((value) => value + 1)}
                    >
                      <Plus size={18} weight="bold" /> <span className="desktop-only">New task</span>
                      <span className="mobile-only">Add</span>
                    </button>
                  </>
                ) : (
                  <button className="primary-button new-task-button" onClick={() => setModal({ type: "new-task" })}>
                    <Plus size={18} weight="bold" /> <span className="desktop-only">New task</span>
                    <span className="mobile-only">Add</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {screen === "overview" && (
            <Overview
              queue={queue}
              tasks={tasks}
              completed={completed}
              scoreEvents={scoreEvents}
              milestones={milestones}
              onNavigate={setScreen}
            />
          )}
          {screen === "review" && (
            <ReviewQueue queue={queue} onApprove={approveDraft} onDismiss={dismissQueueItem} onModal={setModal} />
          )}
          {screen === "extract" && (
            <TaskExtraction
              projects={activeProjectNames(projects)}
              onSendToQueue={sendExtractedToQueue}
              onRemove={dismissQueueItem}
              onNotice={showNotice}
            />
          )}
          {screen === "register" && (
            <WorkRegister
              tasks={tasks}
              projects={projects}
              projectFilter={projectFilter}
              setProjectFilter={setProjectFilter}
              newTaskRequest={newTaskRequest}
              onConsumeNewTaskRequest={() => setNewTaskRequest(0)}
              onCreateTask={createTask}
              onDone={markDone}
              onClearBlocker={clearBlocker}
              onUpdate={updateTask}
              onCreateSubtask={createSubtask}
              onRefresh={refreshRegister}
              onCreateRecurring={() => setModal({ type: "recurring-task" })}
              onEdit={(task) => setModal({ type: "task-edit", task })}
            />
          )}
          {screen === "project" && (
            <ProjectView
              project={selectedProject}
              onProjectChange={setSelectedProject}
              projects={projects}
              tasks={tasks}
              completed={completed}
              milestones={milestones}
              onDone={markDone}
              onClearBlocker={clearBlocker}
              onUpdate={updateTask}
              onEdit={(task) => setModal({ type: "task-edit", task })}
              onCreateProject={createProject}
              onUpdateProjectStatus={updateProjectStatus}
            />
          )}
          {screen === "milestones" && (
            <MilestonesView
              milestones={milestones}
              tasks={tasks}
              projects={activeProjectNames(projects)}
              onAdd={addMilestone}
              onUpdate={updateMilestone}
              onDelete={deleteMilestone}
            />
          )}
          {screen === "completed" && (
            <CompletedView
              completed={completed}
              scoreEvents={scoreEvents}
              period={period}
              setPeriod={setPeriod}
              onUndo={undoCompleted}
            />
          )}
        </main>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              count={item.id === "review" ? queue.length : item.count}
              active={screen === item.id}
              onClick={() => setScreen(item.id)}
              compact
            />
          ))}
        </nav>
      </div>
      {modal && (
        <Modal
          modal={modal}
          onClose={() => setModal(null)}
          onApprove={approveDraft}
          onDismiss={dismissQueueItem}
          onNotice={showNotice}
          onNewTask={createTask}
          onCreateRecurring={createRecurringTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          projectOptions={activeProjectNames(projects)}
        />
      )}
      {celebration && <Confetti key={celebration.id} points={celebration.points} />}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={20} weight="fill" /> {notice}
        </div>
      )}
    </div>
  );
}
export { App };
