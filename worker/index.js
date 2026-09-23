import {
  dateLabel,
  dateOnly,
  effortPoints as points,
  isAnnOwner as ann,
  parseEffort as effort,
  todayKey,
} from "./shared/domain.mjs";
import {
  applySourceItemApproval,
  normalizeMilestoneInput,
  sourceItemApprovalDecision,
  taskAddedScoreEvent,
  validateTaskInput,
} from "./shared/workboard.mjs";
import {
  buildSmartsheetFieldCells,
  buildSmartsheetTaskCells,
  findSmartsheetColumn,
  smartsheetRowValues,
  smartsheetRowId,
} from "./shared/smartsheet.mjs";
import { errorMessage, externalServiceError, statusForError } from "./shared/errors.mjs";

const OWNER = "site-owner";
const json = (value, init = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
const noContent = () => new Response(null, { status: 204 });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function extractedOwner(value) {
  const owner = String(value || "").trim();
  return /^(unknown|unassigned|not found|n\/?a)$/i.test(owner) || !owner ? "Ann" : owner;
}
function task(row) {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    deadline: dateLabel(row.deadline),
    deadlineKey: dateOnly(row.deadline),
    owner: row.owner_name,
    effortHours: Number(row.effort_hours),
    points: points(row.effort_hours),
    status: row.status,
    blocker: row.blocker || undefined,
    notes: row.notes || "",
    notesAi: Boolean(row.notes_ai),
    parentTaskId: row.parent_task_id || undefined,
    recurring: Boolean(row.recurring_task_id),
    sourceKind: row.source_kind || undefined,
  };
}
function completed(row) {
  return {
    id: row.id,
    sourceTaskId: row.task_id,
    title: row.title,
    project: row.project,
    date: dateLabel(row.completed_at),
    dateKey: dateOnly(row.completed_at),
    createdAt: row.completed_at,
    deadline: dateLabel(row.deadline),
    deadlineKey: dateOnly(row.deadline),
    owner: row.owner_name || "Unassigned",
    effortHours: Number(row.effort_hours),
    points: Number(row.points),
    day: new Date(row.completed_at).toLocaleDateString("en-US", { weekday: "short" }),
  };
}
function score(row) {
  return {
    id: row.id,
    date: dateLabel(row.event_date),
    dateKey: dateOnly(row.event_date),
    createdAt: row.created_at,
    amount: Number(row.amount),
    cause: row.cause,
    taskId: row.task_id || undefined,
    title: row.title || "Task",
    project: row.project || "Unassigned",
  };
}
function milestone(row, tasks) {
  return {
    id: row.id,
    name: row.name,
    date: dateLabel(row.milestone_date),
    dateKey: dateOnly(row.milestone_date),
    project: row.project,
    type: row.type,
    linkedTaskIds: tasks
      .filter((entry) => entry.project === row.project && ["active", "blocked"].includes(entry.status))
      .map((entry) => entry.id),
  };
}
function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function upcomingWeekday(weekday) {
  const current = new Date(`${todayKey()}T12:00:00Z`);
  const offset = (Number(weekday) - current.getUTCDay() + 7) % 7;
  return addDays(todayKey(), offset);
}
function recurring(row) {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    owner: row.owner_name,
    effortHours: Number(row.effort_hours),
    weekday: Number(row.weekday),
  };
}
async function body(request) {
  return request.json().catch(() => ({}));
}
async function all(db, sql, ...values) {
  return (
    (
      await db
        .prepare(sql)
        .bind(...values)
        .all()
    ).results || []
  );
}
async function one(db, sql, ...values) {
  return db
    .prepare(sql)
    .bind(...values)
    .first();
}
async function run(db, sql, ...values) {
  return db
    .prepare(sql)
    .bind(...values)
    .run();
}
function profile() {
  return { name: "Ann", email: "" };
}

async function smartsheet(env, path, options = {}) {
  if (!env.SMARTSHEET_ACCESS_TOKEN) throw externalServiceError("Smartsheet is not configured for this Site", 503);
  const response = await fetch(`https://api.smartsheet.com/2.0${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.SMARTSHEET_ACCESS_TOKEN}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw externalServiceError(
      `Smartsheet request failed (${response.status})${detail?.message ? `: ${detail.message}` : ""}`,
      response.status === 429 ? 503 : 502,
    );
  }
  return response.status === 204 ? null : response.json();
}
function cells(row, columns) {
  return smartsheetRowValues(row, columns);
}
function column(columns, ...names) {
  return findSmartsheetColumn(columns, ...names);
}
async function sheet(env) {
  return smartsheet(env, `/sheets/${encodeURIComponent(env.SMARTSHEET_SHEET_ID)}`);
}
async function reconcileCompleted(env, taskId) {
  const current = await one(env.DB, "SELECT * FROM tasks WHERE id=? AND owner_id=?", taskId, OWNER);
  if (!current) return;
  const scorePoints = ann(current.owner_name) ? points(current.effort_hours) : 0;
  const timestamp = now();
  await run(
    env.DB,
    `INSERT INTO completed_tasks(id,owner_id,task_id,title,project,completed_at,effort_hours,points)
    SELECT ?,owner_id,id,title,project,?,?,? FROM tasks
    WHERE id=? AND owner_id=? AND NOT EXISTS (SELECT 1 FROM completed_tasks WHERE owner_id=? AND task_id=?)`,
    id(),
    timestamp,
    current.effort_hours,
    scorePoints,
    taskId,
    OWNER,
    OWNER,
    taskId,
  );
  if (scorePoints > 0)
    await run(
      env.DB,
      `INSERT INTO score_events(id,owner_id,event_date,amount,cause,task_id,created_at)
    SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM score_events WHERE owner_id=? AND task_id=? AND cause='completed task')`,
      id(),
      OWNER,
      todayKey(),
      scorePoints,
      "completed task",
      taskId,
      timestamp,
      OWNER,
      taskId,
    );
}
async function syncSheet(env) {
  if (!env.SMARTSHEET_ACCESS_TOKEN) return;
  const data = await sheet(env);
  const columns = data.columns || [];
  if (!column(columns, "task")) throw new Error("Smartsheet sheet is missing the task column");
  for (const row of data.rows || []) {
    const values = cells(row, columns);
    const title = String(values.task || "").trim();
    if (!title) continue;
    const existing = await one(
      env.DB,
      "SELECT id, status FROM tasks WHERE owner_id=? AND source_kind='smartsheet' AND source_id=?",
      OWNER,
      String(row.id),
    );
    const taskId = existing?.id || id();
    const status = /^(done|complete|completed)$/i.test(String(values.status || "")) ? "completed" : "active";
    const timestamp = now();
    await run(
      env.DB,
      `INSERT INTO tasks (id,owner_id,title,project,deadline,owner_name,effort_hours,status,source_kind,source_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,source_kind,source_id) DO UPDATE SET title=excluded.title,project=excluded.project,deadline=excluded.deadline,owner_name=excluded.owner_name,effort_hours=excluded.effort_hours,status=CASE WHEN tasks.status IN ('completed','deleted') THEN tasks.status ELSE excluded.status END,updated_at=excluded.updated_at`,
      taskId,
      OWNER,
      title,
      String(values.category || "Unassigned"),
      dateOnly(values["due date"]),
      String(values.owner || "Unassigned"),
      effort(values["loe (in hours)"] ?? values.loe),
      status,
      "smartsheet",
      String(row.id),
      timestamp,
      timestamp,
    );
    if (!existing)
      await run(
        env.DB,
        "INSERT INTO score_events (id,owner_id,event_date,amount,cause,task_id,created_at) VALUES (?,?,?,?,?,?,?)",
        id(),
        OWNER,
        todayKey(),
        1,
        "task added",
        taskId,
        timestamp,
      );
    if (status === "completed") await reconcileCompleted(env, taskId);
  }
}
async function addSheetRow(env, item) {
  if (!env.SMARTSHEET_ACCESS_TOKEN) return null;
  const data = await sheet(env);
  const columns = data.columns || [];
  const payload = buildSmartsheetTaskCells(columns, {
    title: item.title,
    project: item.project,
    deadline: dateOnly(item.deadline),
    owner: item.owner,
    effortHours: effort(item.effortHours),
    status: env.SMARTSHEET_APPROVED_STATUS || "To do",
  });
  const result = await smartsheet(env, `/sheets/${encodeURIComponent(env.SMARTSHEET_SHEET_ID)}/rows`, {
    method: "POST",
    body: JSON.stringify([{ toTop: true, cells: payload }]),
  });
  return result?.result?.[0]?.id ? String(result.result[0].id) : null;
}
async function createRecurringOccurrence(env, template, deadline) {
  const timestamp = now();
  const taskId = id();
  const sourceId = await addSheetRow(env, {
    title: template.title,
    project: template.project,
    deadline,
    owner: template.owner_name,
    effortHours: template.effort_hours,
  });
  const eventId = id();
  const addedEvent = taskAddedScoreEvent({
    ownerId: OWNER,
    taskId,
    eventDate: todayKey(),
    createdAt: timestamp,
    id: eventId,
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO tasks(id,owner_id,title,project,deadline,owner_name,effort_hours,status,notes,notes_ai,parent_task_id,recurring_task_id,source_kind,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      taskId,
      OWNER,
      template.title,
      template.project,
      deadline,
      template.owner_name,
      template.effort_hours,
      "active",
      "",
      0,
      null,
      template.id,
      sourceId ? "smartsheet" : null,
      sourceId,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      "INSERT INTO score_events(id,owner_id,event_date,amount,cause,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      addedEvent.id,
      addedEvent.ownerId,
      addedEvent.eventDate,
      addedEvent.amount,
      addedEvent.cause,
      addedEvent.taskId,
      addedEvent.createdAt,
    ),
    env.DB.prepare("UPDATE recurring_tasks SET last_created_date=?,updated_at=? WHERE id=? AND owner_id=?").bind(
      deadline,
      timestamp,
      template.id,
      OWNER,
    ),
  ]);
  return {
    task: task(await one(env.DB, "SELECT * FROM tasks WHERE id=?", taskId)),
    scoreEvent: score(
      await one(
        env.DB,
        "SELECT e.*,t.title,t.project FROM score_events e LEFT JOIN tasks t ON t.id=e.task_id WHERE e.id=?",
        eventId,
      ),
    ),
  };
}
async function updateSheet(env, sourceId, fields) {
  if (!env.SMARTSHEET_ACCESS_TOKEN || !sourceId) return;
  const data = await sheet(env);
  const columns = data.columns || [];
  const payload = buildSmartsheetFieldCells(columns, fields);
  if (!payload.length) return;
  await smartsheet(env, `/sheets/${encodeURIComponent(env.SMARTSHEET_SHEET_ID)}/rows`, {
    method: "PUT",
    body: JSON.stringify([{ id: smartsheetRowId(sourceId), cells: payload }]),
  });
}
async function recordSyncException(env, message) {
  await run(
    env.DB,
    "INSERT INTO source_exceptions(id,owner_id,source,message,status,logged_at) VALUES(?,?,?,?,?,?)",
    id(),
    OWNER,
    "smartsheet",
    message,
    "open",
    now(),
  );
}

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["TASK", "MILESTONE"] },
          title: { type: "string" },
          owner: { type: "string" },
          project: { type: "string" },
          deadline: { type: "string" },
          effortHours: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["type", "title", "owner", "project", "deadline", "effortHours", "evidence"],
      },
    },
  },
  required: ["items"],
};
async function extract(env, source) {
  if (!env.OPENAI_API_KEY) throw externalServiceError("OPENAI_API_KEY is not configured", 503);
  const projects = Array.isArray(source.projectOptions)
    ? source.projectOptions
        .map((project) => String(project).trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
  const imageSource =
    /^data:image\//i.test(source.dataUrl || "") ||
    source.mimeType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(source.fileName || "");
  const screenshotInstruction = imageSource
    ? "This source is an image or screenshot. Visually read every legible row, checkbox, heading, table cell, and date in the image. Treat task-list entries as actionable work even when they are short fragments. Return an item for each distinct task, milestone, or deadline visible in the image."
    : "";
  const instruction = `Read the complete source. Inspect headings, paragraphs, tables, lists, dates, owners, dependencies, and milestone language. Extract every distinct actionable task and meaningful milestone or deadline. ${screenshotInstruction} Do not invent facts or duplicate items. Use empty strings for unknown owner or deadline, 0 for unknown effortHours, concise titles, and a short supporting evidence phrase. ${projects.length ? `Project is a closed-list field. Use only one exact known project when supported; otherwise return an empty string. Known projects: ${projects.map(JSON.stringify).join(", ")}.` : "Return an empty project string unless the source explicitly names one."}`;
  const content = source.dataUrl
    ? [
        { type: "input_text", text: `Source: ${source.label}\nText: ${source.content || "(Inspect uploaded file.)"}` },
        ...(imageSource
          ? [{ type: "input_image", image_url: source.dataUrl, detail: "high" }]
          : [{ type: "input_file", filename: source.fileName || "uploaded-file", file_data: source.dataUrl }]),
      ]
    : `Source: ${source.label}\n${source.content || ""}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.4-mini",
      store: false,
      reasoning: { effort: "medium" },
      instructions: instruction,
      input: source.dataUrl ? [{ role: "user", content }] : content,
      text: { format: { type: "json_schema", name: "work_items", strict: true, schema: extractionSchema } },
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw externalServiceError(
      error?.error?.message || "OpenAI extraction failed",
      response.status === 429 ? 503 : 502,
    );
  }
  const data = await response.json();
  const outputText =
    data.output_text ||
    (data.output || [])
      .flatMap((entry) => entry.content || [])
      .filter((entry) => entry.type === "output_text")
      .map((entry) => entry.text || "")
      .join("");
  const parsed = JSON.parse(outputText || '{"items":[]}');
  return Array.isArray(parsed.items)
    ? parsed.items
        .slice(0, 40)
        .map((item) => (item.type === "TASK" ? { ...item, owner: extractedOwner(item.owner) } : item))
    : [];
}
async function liveState(env) {
  const [taskRows, completedRows, scoreRows, sources, projects, milestoneRows] = await Promise.all([
    all(
      env.DB,
      "SELECT * FROM tasks WHERE owner_id=? AND status IN ('active','blocked') ORDER BY deadline IS NULL, deadline, created_at DESC",
      OWNER,
    ),
    all(
      env.DB,
      "SELECT c.*,t.deadline,t.owner_name FROM completed_tasks c LEFT JOIN tasks t ON t.id=c.task_id WHERE c.owner_id=? ORDER BY c.completed_at DESC",
      OWNER,
    ),
    all(
      env.DB,
      "SELECT e.*,t.title,t.project FROM score_events e LEFT JOIN tasks t ON t.id=e.task_id WHERE e.owner_id=? ORDER BY e.event_date DESC,e.created_at DESC",
      OWNER,
    ),
    all(env.DB, "SELECT * FROM source_items WHERE owner_id=? AND status='unreviewed' ORDER BY created_at DESC", OWNER),
    all(env.DB, "SELECT * FROM projects WHERE owner_id=? ORDER BY status,name", OWNER),
    all(env.DB, "SELECT * FROM milestones WHERE owner_id=? ORDER BY milestone_date,created_at", OWNER),
  ]);
  const queue = sources.flatMap((source) => {
    const payload = JSON.parse(source.payload || "{}");
    const approved = new Set(payload.approvedIndexes || []);
    const dismissed = new Set(payload.dismissedIndexes || []);
    return (payload.extractedItems || []).flatMap((item, index) => {
      if (approved.has(index) || dismissed.has(index)) return [];
      const milestoneItem = item.type === "MILESTONE";
      const missing = (
        milestoneItem
          ? [!item.project && "project", !item.deadline && "date"]
          : [!item.project && "project", !item.owner && "owner", !item.deadline && "deadline"]
      ).filter(Boolean);
      return [
        {
          id: `${source.id}:${index}`,
          sourceItemId: source.id,
          extractedIndex: index,
          type: missing.length ? "unclear" : "draft",
          itemKind: milestoneItem ? "MILESTONE" : "TASK",
          source: source.source,
          sourceKind: "file",
          title: item.title,
          project: item.project || "",
          owner: item.owner || "",
          deadline: dateLabel(item.deadline),
          deadlineKey: dateOnly(item.deadline),
          effortHours: effort(item.effortHours),
          notes: item.evidence || "",
          notesAi: Boolean(item.evidence),
          badge: "AI drafted",
          detail: milestoneItem
            ? `Milestone · ${dateLabel(item.deadline)}`
            : `Task · ${item.owner || "Owner unclear"} · ${dateLabel(item.deadline)}`,
          missing,
        },
      ];
    });
  });
  return {
    profile: profile(),
    tasks: taskRows.map(task),
    completed: completedRows.map(completed),
    scoreEvents: scoreRows.map(score),
    projects: projects.map((row) => ({ id: row.id, name: row.name, status: row.status })),
    milestones: milestoneRows.map((row) => milestone(row, taskRows)),
    queue,
    exceptions: [],
  };
}
function route(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}
async function api(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/health")
    return json({
      ok: true,
      hosted: true,
      openAiConfigured: Boolean(env.OPENAI_API_KEY),
      smartsheetConfigured: Boolean(env.SMARTSHEET_ACCESS_TOKEN),
      databaseConfigured: Boolean(env.DB),
    });
  if (request.method === "GET" && pathname === "/api/state") return json(await liveState(env));
  if (request.method === "POST" && pathname === "/api/sync") {
    await syncSheet(env);
    return json(await liveState(env));
  }
  if (request.method === "POST" && pathname === "/api/projects") {
    const data = await body(request);
    const name = String(data.name || "").trim();
    if (!name) return json({ error: "Project name is required" }, { status: 400 });
    const timestamp = now();
    const projectId = id();
    await run(
      env.DB,
      "INSERT INTO projects(id,owner_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,name) DO UPDATE SET status='active',updated_at=excluded.updated_at",
      projectId,
      OWNER,
      name,
      "active",
      timestamp,
      timestamp,
    );
    return json(await one(env.DB, "SELECT id,name,status FROM projects WHERE owner_id=? AND name=?", OWNER, name), {
      status: 201,
    });
  }
  const projectIdRoute = route(pathname, /^\/api\/projects\/id\/([^/]+)$/);
  if (request.method === "DELETE" && projectIdRoute) {
    const existing = await one(env.DB, "SELECT id FROM projects WHERE id=? AND owner_id=?", projectIdRoute[0], OWNER);
    if (!existing) return json({ error: "Project not found" }, { status: 404 });
    await run(env.DB, "DELETE FROM projects WHERE id=? AND owner_id=?", projectIdRoute[0], OWNER);
    return noContent();
  }
  const projectRoute = route(pathname, /^\/api\/projects\/(.+)$/);
  if (request.method === "PATCH" && projectRoute) {
    const data = await body(request);
    if (data.status !== "active" && data.status !== "finished")
      return json({ error: "Project status must be active or finished" }, { status: 400 });
    const status = data.status === "finished" ? "finished" : "active";
    const timestamp = now();
    await run(
      env.DB,
      "INSERT INTO projects(id,owner_id,name,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,name) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at",
      id(),
      OWNER,
      projectRoute[0],
      status,
      timestamp,
      timestamp,
    );
    return json(
      await one(env.DB, "SELECT id,name,status FROM projects WHERE owner_id=? AND name=?", OWNER, projectRoute[0]),
    );
  }
  if (request.method === "POST" && pathname === "/api/file-extract") {
    const data = await body(request);
    const source = {
      source: `Dropped file · ${data.fileName || "Untitled file"}`,
      id: id(),
      label: data.fileName || "Untitled file",
      fileName: data.fileName,
      mimeType: data.mimeType,
      content: data.text || "",
      dataUrl: data.dataUrl || "",
      projectOptions: data.projectOptions || [],
    };
    let fileKey = null;
    if (source.dataUrl && env.UPLOADS) {
      fileKey = `uploads/${source.id}/${source.fileName || "file"}`;
      const base64 = source.dataUrl.split(",")[1];
      if (base64)
        await env.UPLOADS.put(
          fileKey,
          Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
          { httpMetadata: { contentType: source.mimeType || "application/octet-stream" } },
        );
    }
    const extracted = await extract(env, source);
    const timestamp = now();
    await run(
      env.DB,
      "INSERT INTO source_items(id,owner_id,source,source_id,payload,status,file_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      source.id,
      OWNER,
      source.source,
      source.id,
      JSON.stringify({ label: source.label, extractedItems: extracted }),
      extracted.length ? "unreviewed" : "processed",
      fileKey,
      timestamp,
      timestamp,
    );
    const items = extracted.map((item, index) => ({
      ...item,
      id: `${source.id}:${index}`,
      sourceItemId: source.id,
      extractedIndex: index,
      dateKey: dateOnly(item.deadline),
      dateLabel: dateLabel(item.deadline),
    }));
    return json({ sourceItemId: source.id, items, extractedItems: items });
  }
  if (request.method === "POST" && pathname === "/api/tasks") {
    const data = await body(request);
    const validation = validateTaskInput(data);
    if (!validation.ok) return json({ error: validation.error }, { status: 400 });
    const normalizedTask = validation.value;
    const { title, project, deadline, owner, effortHours: hours, notes, notesAi, parentTaskId } = normalizedTask;
    const timestamp = now();
    const taskId = id();
    await run(
      env.DB,
      "INSERT INTO tasks(id,owner_id,title,project,deadline,owner_name,effort_hours,status,notes,notes_ai,parent_task_id,source_kind,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      taskId,
      OWNER,
      title,
      project,
      dateOnly(deadline),
      owner,
      hours,
      "active",
      notes,
      notesAi ? 1 : 0,
      parentTaskId,
      null,
      null,
      timestamp,
      timestamp,
    );
    const eventId = id();
    const addedEvent = taskAddedScoreEvent({
      ownerId: OWNER,
      taskId,
      eventDate: todayKey(),
      createdAt: timestamp,
      id: eventId,
    });
    await run(
      env.DB,
      "INSERT INTO score_events(id,owner_id,event_date,amount,cause,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
      addedEvent.id,
      addedEvent.ownerId,
      addedEvent.eventDate,
      addedEvent.amount,
      addedEvent.cause,
      addedEvent.taskId,
      addedEvent.createdAt,
    );
    let taskRow = await one(env.DB, "SELECT * FROM tasks WHERE id=?", taskId);
    let syncWarning = null;
    try {
      const sourceId = await addSheetRow(env, {
        title,
        project,
        deadline: data.deadlineKey || data.deadline,
        owner: data.owner || "Unassigned",
        effortHours: hours,
      });
      if (sourceId) {
        await run(
          env.DB,
          "UPDATE tasks SET source_kind='smartsheet',source_id=?,updated_at=? WHERE id=?",
          sourceId,
          now(),
          taskId,
        );
        taskRow = await one(env.DB, "SELECT * FROM tasks WHERE id=?", taskId);
      }
    } catch (error) {
      syncWarning = "Task saved locally, but Smartsheet still needs to be updated";
      await recordSyncException(env, `Task ${taskId}: ${error.message}`);
    }
    const eventRow = await one(
      env.DB,
      "SELECT e.*,t.title,t.project FROM score_events e LEFT JOIN tasks t ON t.id=e.task_id WHERE e.id=?",
      eventId,
    );
    return json({ task: task(taskRow), scoreEvent: score(eventRow), syncWarning }, { status: 201 });
  }
  if (request.method === "POST" && pathname === "/api/recurring-tasks") {
    const data = await body(request);
    const title = String(data.title || "").trim();
    const project = String(data.project || "").trim();
    const ownerName = String(data.owner || "").trim();
    const weekday = Number(data.weekday);
    if (!title || !project || !ownerName || !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      return json({ error: "A title, project, owner, and weekday are required" }, { status: 400 });
    const timestamp = now();
    const templateId = id();
    await run(
      env.DB,
      "INSERT INTO recurring_tasks(id,owner_id,title,project,owner_name,effort_hours,weekday,active,last_created_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      templateId,
      OWNER,
      title,
      project,
      ownerName,
      effort(data.effortHours),
      weekday,
      1,
      null,
      timestamp,
      timestamp,
    );
    const template = await one(env.DB, "SELECT * FROM recurring_tasks WHERE id=?", templateId);
    const occurrence = await createRecurringOccurrence(env, template, upcomingWeekday(weekday));
    return json({ template: recurring(template), ...occurrence }, { status: 201 });
  }
  const taskRoute = route(pathname, /^\/api\/tasks\/([^/]+)$/);
  if (request.method === "PATCH" && taskRoute) {
    const data = await body(request);
    const current = await one(
      env.DB,
      "SELECT * FROM tasks WHERE id=? AND owner_id=? AND status IN ('active','blocked')",
      taskRoute[0],
      OWNER,
    );
    if (!current) return json({ error: "Task not found" }, { status: 404 });
    const next = {
      title: String(data.title || current.title).trim(),
      project: String(data.project || current.project).trim(),
      deadline:
        data.deadline === undefined && data.deadlineKey === undefined
          ? current.deadline
          : dateOnly(data.deadlineKey || data.deadline),
      owner: data.owner || current.owner_name,
      effortHours: data.effortHours === undefined ? current.effort_hours : effort(data.effortHours),
    };
    await run(
      env.DB,
      "UPDATE tasks SET title=?,project=?,deadline=?,owner_name=?,effort_hours=?,notes=?,notes_ai=?,status=?,blocker=?,updated_at=? WHERE id=? AND owner_id=?",
      next.title,
      next.project,
      next.deadline,
      next.owner,
      next.effortHours,
      data.notes ?? current.notes,
      data.notesAi === undefined ? current.notes_ai : data.notesAi ? 1 : 0,
      data.status === "blocked" ? "blocked" : "active",
      data.blocker === undefined ? current.blocker : data.blocker || null,
      now(),
      current.id,
      OWNER,
    );
    let syncWarning = null;
    if (current.source_kind === "smartsheet") {
      try {
        await updateSheet(env, current.source_id, {
          task: next.title,
          category: next.project,
          "due date": next.deadline || "",
          owner: next.owner,
          effort: next.effortHours,
        });
      } catch (error) {
        syncWarning = "Task updated locally, but Smartsheet still needs to be updated";
        await recordSyncException(env, `Task ${current.id}: ${error.message}`);
      }
    }
    return json({ ...task(await one(env.DB, "SELECT * FROM tasks WHERE id=?", current.id)), syncWarning });
  }
  if (request.method === "DELETE" && taskRoute) {
    const current = await one(
      env.DB,
      "SELECT id FROM tasks WHERE id=? AND owner_id=? AND status IN ('active','blocked')",
      taskRoute[0],
      OWNER,
    );
    if (!current) return json({ error: "Task not found" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET status='deleted',updated_at=? WHERE id=? AND owner_id=?").bind(
        now(),
        current.id,
        OWNER,
      ),
      env.DB.prepare("DELETE FROM score_events WHERE owner_id=? AND task_id=? AND cause='task added'").bind(
        OWNER,
        current.id,
      ),
    ]);
    return noContent();
  }
  const completeRoute = route(pathname, /^\/api\/tasks\/([^/]+)\/complete$/);
  if (request.method === "POST" && completeRoute) {
    const current = await one(
      env.DB,
      "SELECT * FROM tasks WHERE id=? AND owner_id=? AND status IN ('active','blocked')",
      completeRoute[0],
      OWNER,
    );
    if (!current) return json({ error: "Task not found" }, { status: 404 });
    const doneId = id();
    const scorePoints = ann(current.owner_name) ? points(current.effort_hours) : 0;
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO completed_tasks(id,owner_id,task_id,title,project,completed_at,effort_hours,points) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(doneId, OWNER, current.id, current.title, current.project, timestamp, current.effort_hours, scorePoints),
      env.DB.prepare("UPDATE tasks SET status='completed',updated_at=? WHERE id=?").bind(timestamp, current.id),
      ...(scorePoints
        ? [
            env.DB.prepare(
              "INSERT INTO score_events(id,owner_id,event_date,amount,cause,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
            ).bind(id(), OWNER, todayKey(), scorePoints, "completed task", current.id, timestamp),
          ]
        : []),
    ]);
    const template = current.recurring_task_id
      ? await one(
          env.DB,
          "SELECT * FROM recurring_tasks WHERE id=? AND owner_id=? AND active=1",
          current.recurring_task_id,
          OWNER,
        )
      : null;
    const nextOccurrence = template
      ? await createRecurringOccurrence(env, template, addDays(current.deadline || todayKey(), 7))
      : null;
    let syncWarning = null;
    if (current.source_kind === "smartsheet") {
      try {
        await updateSheet(env, current.source_id, { status: "Done" });
      } catch (error) {
        syncWarning = "Task completed locally, but Smartsheet still needs to be updated";
        await recordSyncException(env, `Task ${current.id}: ${error.message}`);
      }
    }
    return json({
      ...completed({
        ...(await one(env.DB, "SELECT * FROM completed_tasks WHERE id=?", doneId)),
        deadline: current.deadline,
        owner_name: current.owner_name,
      }),
      nextRecurringTask: nextOccurrence?.task || null,
      syncWarning,
    });
  }
  const undoRoute = route(pathname, /^\/api\/completed\/([^/]+)\/undo$/);
  if (request.method === "POST" && undoRoute) {
    const row = await one(
      env.DB,
      "SELECT c.*,t.source_kind,t.source_id FROM completed_tasks c LEFT JOIN tasks t ON t.id=c.task_id WHERE c.id=? AND c.owner_id=?",
      undoRoute[0],
      OWNER,
    );
    if (!row) return json({ error: "Completed task not found" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("UPDATE tasks SET status='active',updated_at=? WHERE id=?").bind(now(), row.task_id),
      env.DB.prepare("DELETE FROM score_events WHERE task_id=? AND owner_id=? AND cause='completed task'").bind(
        row.task_id,
        OWNER,
      ),
      env.DB.prepare("DELETE FROM completed_tasks WHERE id=?").bind(row.id),
    ]);
    if (row.source_kind === "smartsheet") {
      try {
        await updateSheet(env, row.source_id, { status: "To do" });
      } catch (error) {
        await recordSyncException(env, `Task ${row.task_id}: ${error.message}`);
      }
    }
    return noContent();
  }
  if (request.method === "POST" && pathname === "/api/milestones") {
    const data = await body(request);
    const milestoneInput = normalizeMilestoneInput(data);
    if (!milestoneInput.name || !milestoneInput.date)
      return json({ error: "A milestone name and date are required" }, { status: 400 });
    const milestoneId = id();
    const timestamp = now();
    await run(
      env.DB,
      "INSERT INTO milestones(id,owner_id,name,milestone_date,project,type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      milestoneId,
      OWNER,
      milestoneInput.name,
      milestoneInput.date,
      milestoneInput.project,
      milestoneInput.type,
      timestamp,
      timestamp,
    );
    const rows = await all(env.DB, "SELECT * FROM tasks WHERE owner_id=? AND status IN ('active','blocked')", OWNER);
    return json(milestone(await one(env.DB, "SELECT * FROM milestones WHERE id=?", milestoneId), rows), {
      status: 201,
    });
  }
  const milestoneRoute = route(pathname, /^\/api\/milestones\/([^/]+)$/);
  if (request.method === "PATCH" && milestoneRoute) {
    const data = await body(request);
    const milestoneInput = normalizeMilestoneInput(data);
    if (!milestoneInput.name || !milestoneInput.date)
      return json({ error: "A milestone name and date are required" }, { status: 400 });
    await run(
      env.DB,
      "UPDATE milestones SET name=?,milestone_date=?,project=?,type=?,updated_at=? WHERE id=? AND owner_id=?",
      milestoneInput.name,
      milestoneInput.date,
      milestoneInput.project,
      milestoneInput.type,
      now(),
      milestoneRoute[0],
      OWNER,
    );
    const rows = await all(env.DB, "SELECT * FROM tasks WHERE owner_id=? AND status IN ('active','blocked')", OWNER);
    const found = await one(env.DB, "SELECT * FROM milestones WHERE id=?", milestoneRoute[0]);
    return found ? json(milestone(found, rows)) : json({ error: "Milestone not found" }, { status: 404 });
  }
  if (request.method === "DELETE" && milestoneRoute) {
    const existing = await one(env.DB, "SELECT id FROM milestones WHERE id=? AND owner_id=?", milestoneRoute[0], OWNER);
    if (!existing) return json({ error: "Milestone not found" }, { status: 404 });
    await run(env.DB, "DELETE FROM milestones WHERE id=? AND owner_id=?", milestoneRoute[0], OWNER);
    return noContent();
  }
  const approvalRoute = route(pathname, /^\/api\/source-items\/([^/]+)\/approve$/);
  if (request.method === "POST" && approvalRoute) {
    const data = await body(request);
    const source = await one(env.DB, "SELECT * FROM source_items WHERE id=? AND owner_id=?", approvalRoute[0], OWNER);
    if (!source) return json({ error: "Source item not found" }, { status: 404 });
    const payload = JSON.parse(source.payload || "{}");
    const decision = sourceItemApprovalDecision(payload, data.extractedIndex, data.values || {});
    if (!decision.ok) return json({ error: decision.error }, { status: 400 });
    if (decision.alreadyApproved) return json({ alreadyApproved: true });
    let result;
    if (decision.isMilestone) {
      const milestoneId = id();
      await run(
        env.DB,
        "INSERT INTO milestones(id,owner_id,name,milestone_date,project,type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        milestoneId,
        OWNER,
        decision.milestone.name,
        decision.milestone.date,
        decision.milestone.project,
        decision.milestone.type,
        now(),
        now(),
      );
      result = { kind: "milestone" };
    } else {
      const { task: approvedTask } = decision;
      const taskId = id();
      const timestamp = now();
      const addedEvent = taskAddedScoreEvent({
        ownerId: OWNER,
        taskId,
        eventDate: todayKey(),
        createdAt: timestamp,
        id: id(),
      });
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO tasks(id,owner_id,title,project,deadline,owner_name,effort_hours,status,notes,notes_ai,source_kind,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          taskId,
          OWNER,
          approvedTask.title,
          approvedTask.project,
          dateOnly(approvedTask.deadline),
          approvedTask.owner,
          approvedTask.effortHours,
          "active",
          approvedTask.notes,
          approvedTask.notesAi ? 1 : 0,
          source.source,
          source.source_id,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          "INSERT INTO score_events(id,owner_id,event_date,amount,cause,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          addedEvent.id,
          addedEvent.ownerId,
          addedEvent.eventDate,
          addedEvent.amount,
          addedEvent.cause,
          addedEvent.taskId,
          addedEvent.createdAt,
        ),
      ]);
      result = { kind: "task", taskId, task: approvedTask };
    }
    const approved = applySourceItemApproval(payload, decision.index);
    await run(
      env.DB,
      "UPDATE source_items SET payload=?,status=?,updated_at=? WHERE id=?",
      JSON.stringify(approved.payload),
      approved.status,
      now(),
      source.id,
    );
    let syncWarning = null;
    if (result.kind === "task") {
      try {
        const sourceId = await addSheetRow(env, {
          ...result.task,
        });
        if (sourceId)
          await run(
            env.DB,
            "UPDATE tasks SET source_kind='smartsheet',source_id=?,updated_at=? WHERE id=?",
            sourceId,
            now(),
            result.taskId,
          );
      } catch (error) {
        syncWarning = "Task approved locally, but Smartsheet still needs to be updated";
        await recordSyncException(env, `Approved task ${result.taskId}: ${error.message}`);
      }
      delete result.taskId;
      delete result.task;
    }
    return json({ ...result, syncWarning }, { status: 201 });
  }
  const dismissRoute = route(pathname, /^\/api\/source-items\/([^/]+)\/dismiss$/);
  if (request.method === "POST" && dismissRoute) {
    const data = await body(request);
    const source = await one(env.DB, "SELECT * FROM source_items WHERE id=? AND owner_id=?", dismissRoute[0], OWNER);
    if (!source) return json({ error: "Source item not found" }, { status: 404 });
    const payload = JSON.parse(source.payload || "{}");
    const dismissedIndexes = [...new Set([...(payload.dismissedIndexes || []), Number(data.extractedIndex)])];
    const status =
      dismissedIndexes.length + (payload.approvedIndexes || []).length >= (payload.extractedItems || []).length
        ? "dismissed"
        : "unreviewed";
    await run(
      env.DB,
      "UPDATE source_items SET payload=?,status=?,updated_at=? WHERE id=?",
      JSON.stringify({ ...payload, dismissedIndexes }),
      status,
      now(),
      source.id,
    );
    return noContent();
  }
  return json({ error: "Not found" }, { status: 404 });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env);
      } catch (error) {
        return json({ error: errorMessage(error, "Request failed") }, { status: statusForError(error) });
      }
    }
    const response = await env.ASSETS.fetch(request);
    const html = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !html || !["GET", "HEAD"].includes(request.method)) return response;
    const index = new URL(request.url);
    index.pathname = "/index.html";
    index.search = "";
    return env.ASSETS.fetch(new Request(index, request));
  },
};
