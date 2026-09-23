import { effortPoints, parseDeadline, parseEffort } from "./domain.mjs";

export const TASK_VALIDATION_ERROR = "Task title, project, and positive effort are required";

export function validateTaskInput(input = {}, { requireProject = true } = {}) {
  const title = String(input.title ?? "").trim();
  const project = String(input.project ?? "").trim();
  const numericEffort = Number(input.effortHours);
  if (!title || (requireProject && !project) || !Number.isFinite(numericEffort) || numericEffort <= 0) {
    return { ok: false, error: TASK_VALIDATION_ERROR };
  }
  return {
    ok: true,
    value: {
      title,
      project,
      deadline: input.deadline ?? input.deadlineKey ?? null,
      owner: String(input.owner ?? "").trim() || "Unassigned",
      effortHours: parseEffort(numericEffort),
      notes: input.notes ?? "",
      notesAi: Boolean(input.notesAi),
      parentTaskId: input.parentTaskId || null,
    },
  };
}

export function scoreEventValues({ ownerId, amount, cause, taskId, eventDate, createdAt, id = null }) {
  return { id, ownerId, amount: Number(amount), cause, taskId: taskId || null, eventDate, createdAt };
}

export function taskAddedScoreEvent({ ownerId, taskId, eventDate, createdAt, id } = {}) {
  return scoreEventValues({ ownerId, amount: 1, cause: "task added", taskId, eventDate, createdAt, id });
}

export function completedTaskScoreEvent({ ownerId, taskId, owner, effortHours, eventDate, createdAt, id } = {}) {
  return scoreEventValues({
    ownerId,
    amount: /ann/i.test(String(owner || "")) ? effortPoints(effortHours) : 0,
    cause: "completed task",
    taskId,
    eventDate,
    createdAt,
    id,
  });
}

export function normalizeMilestoneInput(input = {}, options = {}) {
  const name = String(input.name ?? input.title ?? "").trim();
  const date = parseDeadline(input.date ?? input.dateKey ?? input.deadline, options);
  return {
    name,
    date,
    project: String(input.project ?? "").trim() || "Unassigned",
    type: input.type === "Deadline" || input.milestoneType === "Deadline" ? "Deadline" : "Milestone",
  };
}

export function sourceItemApprovalDecision(payload = {}, indexValue, values = {}, options = {}) {
  const index = Number(indexValue);
  const item = Number.isInteger(index) ? payload.extractedItems?.[index] : null;
  if (!item) return { ok: false, error: "Extracted item not found" };
  if ((payload.approvedIndexes || []).includes(index)) return { ok: true, alreadyApproved: true, index, item };
  const isMilestone = item.type === "MILESTONE" || values.itemKind === "MILESTONE";
  if (isMilestone) {
    const milestone = normalizeMilestoneInput(
      {
        name: values.title || item.title,
        date: values.deadline || item.deadline,
        project: values.project || item.project,
        type: values.milestoneType,
      },
      options,
    );
    return {
      ok: Boolean(milestone.name && milestone.date),
      error: "A milestone name and date are required",
      index,
      item,
      isMilestone,
      milestone,
    };
  }
  const task = {
    title: values.title || item.title,
    project: values.project || item.project || "Unassigned",
    deadline: values.deadline || item.deadline || null,
    owner: values.owner || item.owner || "Unassigned",
    effortHours: parseEffort(values.effortHours ?? item.effortHours),
    notes: values.notes || item.evidence || "",
    notesAi: Boolean(values.notes || item.evidence),
  };
  return { ok: Boolean(task.title), error: "A task title is required", index, item, isMilestone: false, task };
}

export function applySourceItemApproval(payload = {}, indexValue) {
  const index = Number(indexValue);
  const approvedIndexes = Array.from(new Set([...(payload.approvedIndexes || []), index]));
  const extracted = payload.extractedItems || [];
  const status =
    approvedIndexes.length + (payload.dismissedIndexes || []).length >= extracted.length ? "approved" : "unreviewed";
  return { payload: { ...payload, approvedIndexes }, status };
}
