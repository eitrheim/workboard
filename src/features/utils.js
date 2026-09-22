import { dateKeyFromDate } from "../../shared/domain.mjs";

function todayKey() {
  return dateKeyFromDate(new Date(), "America/Los_Angeles");
}

function todayLongLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function registerDraft(task) {
  return {
    title: task.title,
    project: task.project,
    deadline: task.deadline,
    deadlineKey: task.deadlineKey,
    owner: task.owner,
    effortHours: task.effortHours,
  };
}

function emptyTaskDraft(index = 0) {
  return {
    id: `new-task-row-${Date.now()}-${index}`,
    title: "",
    project: "",
    deadline: "",
    deadlineKey: null,
    owner: "",
    effortHours: "",
  };
}

function addDaysToKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildSubtaskDrafts(task) {
  const effort = Math.max(0.25, Number(task.effortHours) || 1);
  const firstEffort = Math.max(0.25, Math.round(effort * 0.35 * 4) / 4);
  const secondEffort = Math.max(0.25, Math.round(effort * 0.4 * 4) / 4);
  return [
    {
      id: `${task.id}-subtask-a`,
      title: `Gather inputs for ${task.title}`,
      project: task.project,
      deadline: task.deadline,
      deadlineKey: task.deadlineKey,
      owner: task.owner,
      effortHours: firstEffort,
      aiSuggested: true,
    },
    {
      id: `${task.id}-subtask-b`,
      title: `Complete the first pass of ${task.title}`,
      project: task.project,
      deadline: task.deadline,
      deadlineKey: task.deadlineKey,
      owner: task.owner,
      effortHours: secondEffort,
      aiSuggested: true,
    },
    emptySubtaskDraft(task, 2),
  ];
}

function emptySubtaskDraft(task, index) {
  return {
    id: `${task.id}-subtask-new-${Date.now()}-${index}`,
    title: "",
    project: "",
    deadline: "",
    deadlineKey: null,
    owner: "",
    effortHours: "",
    aiSuggested: false,
  };
}

function deadlineKeyFromLabel(value, fallback = null) {
  if (!value || value === "No deadline") return null;
  if (value === "Today") return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = Date.parse(`${value} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString().slice(0, 10);
}

function normalizedDateKey(value, fallback = null) {
  const match = String(value || "")
    .trim()
    .match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : deadlineKeyFromLabel(value) || deadlineKeyFromLabel(fallback);
}

function normalizeMilestone(milestone) {
  return { ...milestone, dateKey: normalizedDateKey(milestone?.dateKey, milestone?.date) };
}

function calendarDateValue(value, dateKey) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return dateKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return value;
  return deadlineKeyFromLabel(value) || "";
}

function effortPoints(hours) {
  if (Number(hours) >= 4) return 40;
  if (Number(hours) > 1) return 20;
  return 10;
}

function isAnnOwner(owner) {
  return (
    String(owner || "")
      .trim()
      .toLowerCase() === "ann"
  );
}

export {
  todayKey,
  todayLongLabel,
  registerDraft,
  emptyTaskDraft,
  addDaysToKey,
  buildSubtaskDrafts,
  emptySubtaskDraft,
  deadlineKeyFromLabel,
  normalizedDateKey,
  normalizeMilestone,
  calendarDateValue,
  effortPoints,
  isAnnOwner,
};
