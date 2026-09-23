import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  dateKeyFromDate as domainDateKeyFromDate,
  dateLabel as domainDateLabel,
  dateOnly as domainDateOnly,
  effortPoints,
  isAnnOwner,
  parseDeadline as domainParseDeadline,
  parseEffort,
} from "../shared/domain.mjs";
import {
  applySourceItemApproval,
  normalizeMilestoneInput,
  sourceItemApprovalDecision,
  taskAddedScoreEvent,
  validateTaskInput,
} from "../shared/workboard.mjs";
import {
  buildSmartsheetFieldCells,
  buildSmartsheetTaskCells,
  findSmartsheetColumn,
  smartsheetRowId,
  smartsheetRowValues,
} from "../shared/smartsheet.mjs";
import { errorMessage, externalServiceError, statusForError } from "../shared/errors.mjs";

dotenv.config();

const { Pool } = pg;
const port = Number(process.env.PORT || 8787);
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const localOwnerId = process.env.LOCAL_OWNER_ID || "local-connector-import-user";
const smartsheetToken = process.env.SMARTSHEET_ACCESS_TOKEN || "";
const smartsheetSheetId = process.env.SMARTSHEET_SHEET_ID || "cfgw3V4qfMwxH8XjPRFQP46p578vm5Fgc3wFGWF1";
const smartsheetApprovedStatus = process.env.SMARTSHEET_APPROVED_STATUS || "To do";

const databaseUrl = process.env.DATABASE_URL || "";
const localDatabase = /(?:localhost|127\.0\.0\.1|::1)/i.test(databaseUrl);
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "false" || localDatabase ? false : { rejectUnauthorized: false },
    })
  : null;
const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:4173";
const localFrontendOrigins = new Set([
  frontendOrigin,
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
]);
const appTimeZone = process.env.APP_TIMEZONE || "America/Los_Angeles";

app.use((req, res, next) => {
  const requestOrigin = req.get("origin");
  res.setHeader(
    "Access-Control-Allow-Origin",
    localFrontendOrigins.has(requestOrigin) ? requestOrigin : frontendOrigin,
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json({ limit: "10mb" }));

function requireAppAccess(_req, _res, next) {
  next();
}

function requireDatabase(_req, res, next) {
  if (!pool) return res.status(503).json({ error: "Local PostgreSQL is not configured" });
  next();
}

function userId() {
  return localOwnerId;
}

function currentProfile() {
  return { name: "Ann", email: "" };
}

const dateOnly = (value) => domainDateOnly(value, { timeZone: appTimeZone });
const todayKey = () => domainDateKeyFromDate(new Date(), appTimeZone);
const dateLabel = (value) => domainDateLabel(value, { timeZone: appTimeZone });
const parseDeadline = (value) => domainParseDeadline(value, { timeZone: appTimeZone });

function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    project: row.project,
    projectId: row.project_id || undefined,
    deadline: dateLabel(row.deadline),
    deadlineKey: dateOnly(row.deadline),
    owner: row.owner_name,
    effortHours: Number(row.effort_hours),
    points: [10, 20, 40].includes(Number(row.points)) ? Number(row.points) : effortPoints(Number(row.effort_hours)),
    status: row.status,
    blocker: row.blocker || undefined,
    notes: row.notes || "",
    notesAi: Boolean(row.notes_ai),
    parentTaskId: row.parent_task_id || undefined,
    sourceKind: row.source_kind || undefined,
  };
}

function serializeCompleted(row) {
  return {
    id: row.id,
    sourceTaskId: row.task_id,
    title: row.title,
    project: row.project,
    projectId: row.project_id || undefined,
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

function serializeScoreEvent(row) {
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
    projectId: row.project_id || undefined,
  };
}

function serializeProject(row) {
  return { id: row.id, name: row.name, status: row.status };
}

async function smartsheetRequest(path, options = {}) {
  if (!smartsheetToken) throw new Error("SMARTSHEET_ACCESS_TOKEN is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SMARTSHEET_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(`https://api.smartsheet.com/2.0${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${smartsheetToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!response.ok)
      throw externalServiceError(`Smartsheet request failed (${response.status})`, response.status === 429 ? 503 : 502);
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw externalServiceError("Smartsheet request timed out", 503, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function smartsheetCells(row, columns) {
  return smartsheetRowValues(row, columns);
}

async function reconcileSmartsheetCompletion(owner, taskId) {
  const result = await pool.query("select * from tasks where id=$1 and owner_id=$2", [taskId, owner]);
  if (!result.rows.length) return;
  const task = result.rows[0];
  const points = isAnnOwner(task.owner_name) ? effortPoints(task.effort_hours) : 0;
  await pool.query(
    `insert into completed_tasks(owner_id, task_id, title, project, effort_hours, points)
    select $1, t.id, t.title, t.project, t.effort_hours, $2
    from tasks t
    where t.id=$3 and t.owner_id=$1
      and not exists (select 1 from completed_tasks c where c.owner_id=$1 and c.task_id=t.id)`,
    [owner, points, taskId],
  );
  if (points > 0) {
    await pool.query(
      `insert into score_events(owner_id, amount, cause, task_id)
      select $1, $2, 'completed task', $3
      where not exists (select 1 from score_events where owner_id=$1 and task_id=$3 and cause='completed task')`,
      [owner, points, taskId],
    );
  }
}

async function syncSmartsheetTasks(owner) {
  if (!smartsheetToken) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const columns = sheet.columns || [];
  const taskColumn = findSmartsheetColumn(columns, "task");
  const statusColumn = findSmartsheetColumn(columns, "status");
  if (!taskColumn) throw new Error("Smartsheet sheet is missing the task column");
  for (const row of sheet.rows || []) {
    const values = smartsheetCells(row, columns);
    const title = String(values.task || "").trim();
    if (!title) continue;
    const sheetStatus = String(values.status || "To do").trim();
    const normalizedStatus = /^(done|complete|completed)$/i.test(sheetStatus) ? "completed" : "active";
    const result = await pool.query(
      "insert into tasks(owner_id,title,project,deadline,owner_name,effort_hours,status,source_kind,source_id) values($1,$2,$3,$4,$5,$6,$7,'smartsheet',$8) on conflict (owner_id, source_kind, source_id) where source_kind is not null and source_id is not null do update set title=excluded.title, project=excluded.project, deadline=excluded.deadline, owner_name=excluded.owner_name, effort_hours=excluded.effort_hours, status=case when tasks.status='completed' then tasks.status else excluded.status end, updated_at=now() returning id",
      [
        owner,
        title,
        String(values.category || "Unassigned") || "Unassigned",
        parseDeadline(values["due date"]),
        String(values.owner || "Unassigned") || "Unassigned",
        parseEffort(values["loe (in hours)"] ?? values.loe),
        normalizedStatus,
        String(row.id),
      ],
    );
    const taskId = result.rows[0].id;
    await pool.query(
      "insert into score_events(owner_id, amount, cause, task_id) select $1, $2, $3, $4 where not exists (select 1 from score_events where owner_id=$1 and task_id=$4 and cause=$3)",
      [owner, 1, "task added", taskId],
    );
    if (normalizedStatus === "completed") await reconcileSmartsheetCompletion(owner, taskId);
  }
  return { rows: sheet.rows?.length || 0, statusColumn: Boolean(statusColumn) };
}

async function addApprovedTaskToSmartsheet(item) {
  if (!smartsheetToken) return null;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const columns = sheet.columns || [];
  const cells = buildSmartsheetTaskCells(columns, {
    title: item.title,
    project: item.project,
    deadline: item.deadline && item.deadline !== "No deadline" ? parseDeadline(item.deadline) : "",
    owner: item.owner,
    effortHours: parseEffort(item.effortHours),
    status: smartsheetApprovedStatus,
  });
  const result = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, {
    method: "POST",
    body: JSON.stringify([{ toTop: true, cells }]),
  });
  return result?.result?.[0]?.id || null;
}

async function updateSmartsheetTaskStatus(sourceId, status) {
  if (!smartsheetToken || !sourceId) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const statusColumn = findSmartsheetColumn(sheet.columns || [], "status");
  if (!statusColumn) throw new Error("Smartsheet sheet is missing the Status column");
  const rowId = smartsheetRowId(sourceId);
  await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, {
    method: "PUT",
    body: JSON.stringify([{ id: rowId, cells: [{ columnId: statusColumn.id, value: status }] }]),
  });
}

async function updateSmartsheetTaskFields(task) {
  if (!smartsheetToken || task.source_kind !== "smartsheet" || !task.source_id) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const columns = sheet.columns || [];
  const cells = buildSmartsheetFieldCells(columns, {
    task: task.title,
    category: task.project || "Unassigned",
    "due date": task.deadline ? dateOnly(task.deadline) : "",
    owner: task.owner_name || "Unassigned",
    effort: parseEffort(task.effort_hours),
  });
  if (!cells.length) return;
  const rowId = smartsheetRowId(task.source_id);
  await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, {
    method: "PUT",
    body: JSON.stringify([{ id: rowId, cells }]),
  });
}

async function recordSyncException(owner, message) {
  try {
    await pool.query("insert into source_exceptions(owner_id, source, message) values ($1, 'smartsheet', $2)", [
      owner,
      message,
    ]);
  } catch (error) {
    console.error("Could not record Smartsheet sync exception", error);
  }
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

async function extractItems(source) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");
  const projectOptions = Array.isArray(source.projectOptions)
    ? source.projectOptions
        .map((project) => String(project).trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
  const projectInstruction = projectOptions.length
    ? ` Known active projects are: ${projectOptions.map((project) => JSON.stringify(project)).join(", ")}. Project is a closed-list field: assign only one of those exact project names when the source supports it; otherwise return an empty project string. Never invent, normalize, or create a project name.`
    : " If no known project list is supplied or the source does not clearly identify one, return an empty project string.";
  const response = await openai.responses.create({
    model: openAiModel,
    store: false,
    reasoning: { effort: "medium" },
    instructions: `Read the entire supplied source. Inspect headings, paragraphs, tables, lists, page content, dates, owners, dependencies, and milestone language. Extract every distinct actionable task and meaningful milestone or deadline, including work assigned to anyone, not only the signed-in user. Do not invent facts or duplicate items. Use empty strings for unknown owner or deadline. Use 0 for unknown effortHours. Return concise titles and a short supporting evidence phrase.${projectInstruction}`,
    input: source.dataUrl
      ? [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Source type: ${source.kind}\nSource label: ${source.label}\nExtracted text, if available:\n${source.content || "(No browser text available; inspect the attached file.)"}`,
              },
              ...(source.mimeType?.startsWith("image/")
                ? [{ type: "input_image", image_url: source.dataUrl, detail: "high" }]
                : [{ type: "input_file", filename: source.fileName || "uploaded-file", file_data: source.dataUrl }]),
            ],
          },
        ]
      : `Source type: ${source.kind}\nSource label: ${source.label}\nSource content:\n${source.content}`,
    text: { format: { type: "json_schema", name: "work_items", strict: true, schema: extractionSchema } },
  });
  const parsed = JSON.parse(response.output_text || '{"items":[]}');
  return Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : [];
}

function serializeMilestone(row, taskRows) {
  const key = dateOnly(row.milestone_date);
  return {
    id: row.id,
    name: row.name,
    date: dateLabel(key),
    dateKey: key,
    project: row.project,
    type: row.type,
    linkedTaskIds: taskRows
      .filter((task) => task.project === row.project && ["active", "blocked"].includes(task.status))
      .map((task) => task.id),
  };
}

function queueFromSourceRow(row) {
  const payload = row.payload || {};
  const extractedItems = Array.isArray(payload.extractedItems) ? payload.extractedItems : [];
  const approved = new Set(payload.approvedIndexes || []);
  const dismissed = new Set(payload.dismissedIndexes || []);
  return extractedItems.flatMap((item, index) => {
    if (approved.has(index) || dismissed.has(index)) return [];
    const isMilestone = item.type === "MILESTONE";
    const missing = (
      isMilestone
        ? [!item.project && "project", !item.deadline && "date"]
        : [!item.project && "project", !item.owner && "owner", !item.deadline && "deadline"]
    ).filter(Boolean);
    return [
      {
        id: `${row.id}:${index}`,
        sourceItemId: row.id,
        extractedIndex: index,
        type: missing.length ? "unclear" : "draft",
        itemKind: isMilestone ? "MILESTONE" : "TASK",
        source: payload.label || row.source,
        sourceKind:
          payload.kind === "outlook"
            ? "outlook"
            : payload.kind === "teams"
              ? "teams"
              : payload.kind === "file"
                ? "file"
                : "outlook",
        title: item.title,
        project: item.project,
        owner: item.owner,
        deadline: item.deadline,
        deadlineKey: parseDeadline(item.deadline),
        effortHours: item.effortHours || 1,
        badge: missing.length ? "Needs input" : "AI drafted",
        detail: missing.length
          ? `Missing: ${missing.join(", ")}`
          : `${isMilestone ? "Milestone" : "Task"}${isMilestone ? "" : ` · ${item.owner}`} · ${item.deadline}`,
      },
    ];
  });
}

async function readLiveState(req) {
  const owner = userId(req);
  const [tasks, completed, scoreEvents, sourceItems, projects, milestones] = await Promise.all([
    pool.query(
      "select * from tasks where owner_id = $1 and status in ('active', 'blocked') order by deadline nulls last, created_at desc",
      [owner],
    ),
    pool.query(
      "select c.*, t.deadline, t.owner_name from completed_tasks c left join tasks t on t.id = c.task_id where c.owner_id = $1 order by c.completed_at desc",
      [owner],
    ),
    pool.query(
      "select e.*, t.title, t.project from score_events e left join tasks t on t.id = e.task_id where e.owner_id = $1 order by e.event_date desc, e.created_at desc",
      [owner],
    ),
    pool.query(
      "select id, source, payload from source_items where owner_id = $1 and status = 'unreviewed' order by created_at desc",
      [owner],
    ),
    pool.query("select id, name, status from projects where owner_id = $1 order by status, name", [owner]),
    pool.query("select * from milestones where owner_id = $1 order by milestone_date, created_at", [owner]),
  ]);
  const queue = sourceItems.rows.flatMap(queueFromSourceRow);
  const projectMap = new Map(projects.rows.map((project) => [project.name, serializeProject(project)]));
  [...tasks.rows, ...completed.rows].forEach((row) => {
    if (row.project && !projectMap.has(row.project))
      projectMap.set(row.project, { id: "inferred-" + row.project, name: row.project, status: "active" });
  });
  return {
    tasks: tasks.rows.map(serializeTask),
    completed: completed.rows.map(serializeCompleted),
    scoreEvents: scoreEvents.rows.map(serializeScoreEvent),
    queue,
    projects: [...projectMap.values()],
    milestones: milestones.rows.map((row) => serializeMilestone(row, tasks.rows)),
    profile: currentProfile(),
    persistence: "postgres",
  };
}

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    localOnly: true,
    openAiConfigured: Boolean(openai),
    smartsheetConfigured: Boolean(smartsheetToken),
    databaseConfigured: Boolean(pool),
  }),
);

app.post("/api/sync", requireAppAccess, requireDatabase, async (req, res) => {
  if (!smartsheetToken) return res.status(503).json({ error: "SMARTSHEET_ACCESS_TOKEN is not configured" });
  try {
    const smartsheet = await syncSmartsheetTasks(userId(req));
    const state = await readLiveState(req);
    res.json({ syncedAt: new Date().toISOString(), smartsheet, state });
  } catch (error) {
    res.status(statusForError(error, 500)).json({ error: errorMessage(error, "Smartsheet refresh failed") });
  }
});

app.get("/api/state", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    res.json(await readLiveState(req));
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/file-extract", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    const fileName = String(req.body.fileName || "uploaded-file").trim();
    const mimeType = String(req.body.mimeType || "application/octet-stream");
    const content = String(req.body.text || "").slice(0, 200000);
    const dataUrl = typeof req.body.dataUrl === "string" ? req.body.dataUrl : "";
    const projectOptions = Array.isArray(req.body.projectOptions) ? req.body.projectOptions : [];
    if (!content && !dataUrl) return res.status(400).json({ error: "File content is required" });
    const source = {
      kind: "file",
      source: "file_upload",
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: `Dropped file · ${fileName}`,
      content,
      dataUrl,
      mimeType,
      fileName,
      projectOptions,
    };
    const extractedItems = await extractItems(source);
    const inserted = await pool.query(
      "insert into source_items(owner_id, source, source_id, payload, status) values ($1, $2, $3, $4, $5) returning id",
      [
        userId(req),
        source.source,
        source.id,
        JSON.stringify({ kind: source.kind, label: source.label, extractedItems }),
        extractedItems.length ? "unreviewed" : "processed",
      ],
    );
    const sourceItemId = inserted.rows[0].id;
    res.status(201).json({
      sourceItemId,
      items: extractedItems.map((item, index) => ({
        ...item,
        id: `${sourceItemId}:${index}`,
        dateLabel: item.deadline || "",
        dateKey: parseDeadline(item.deadline),
        sourceItemId,
        extractedIndex: index,
      })),
    });
  } catch (error) {
    res.status(statusForError(error, 502)).json({ error: errorMessage(error, "File extraction failed") });
  }
});

app.post("/api/milestones", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const milestoneInput = normalizeMilestoneInput(req.body, { timeZone: appTimeZone });
    if (!milestoneInput.name || !milestoneInput.date)
      return res.status(400).json({ error: "Milestone name and date are required" });
    const result = await pool.query(
      "insert into milestones(owner_id, name, milestone_date, project, type) values ($1,$2,$3,$4,$5) returning *",
      [userId(req), milestoneInput.name, milestoneInput.date, milestoneInput.project, milestoneInput.type],
    );
    const tasks = await pool.query(
      "select id, project, status from tasks where owner_id=$1 and status in ('active','blocked')",
      [userId(req)],
    );
    res.status(201).json(serializeMilestone(result.rows[0], tasks.rows));
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.patch("/api/milestones/:id", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const milestoneInput = normalizeMilestoneInput(req.body, { timeZone: appTimeZone });
    if (!milestoneInput.name || !milestoneInput.date)
      return res.status(400).json({ error: "Milestone name and date are required" });
    const result = await pool.query(
      "update milestones set name=$1, milestone_date=$2, project=$3, type=$4, updated_at=now() where id=$5 and owner_id=$6 returning *",
      [
        milestoneInput.name,
        milestoneInput.date,
        milestoneInput.project,
        milestoneInput.type,
        req.params.id,
        userId(req),
      ],
    );
    if (!result.rows.length) return res.status(404).json({ error: "Milestone not found" });
    const tasks = await pool.query(
      "select id, project, status from tasks where owner_id=$1 and status in ('active','blocked')",
      [userId(req)],
    );
    res.json(serializeMilestone(result.rows[0], tasks.rows));
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/projects", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Project name is required" });
    const result = await pool.query(
      "insert into projects(owner_id, name) values ($1, $2) on conflict(owner_id, name) do update set status='active', updated_at=now() returning id, name, status",
      [userId(req), name],
    );
    res.status(201).json(serializeProject(result.rows[0]));
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.patch("/api/projects/:name", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    const status = req.body.status;
    if (!name || !["active", "finished"].includes(status))
      return res.status(400).json({ error: "Project name and valid status are required" });
    const result = await pool.query(
      "insert into projects(owner_id, name, status) values ($1, $2, $3) on conflict(owner_id, name) do update set status=excluded.status, updated_at=now() returning id, name, status",
      [userId(req), name, status],
    );
    res.json(serializeProject(result.rows[0]));
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/tasks", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const validation = validateTaskInput(req.body);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const normalizedTask = validation.value;
    const result = await pool.query(
      "insert into tasks(owner_id, title, project, deadline, owner_name, effort_hours, notes, notes_ai, parent_task_id, source_kind, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *",
      [
        userId(req),
        normalizedTask.title,
        normalizedTask.project,
        parseDeadline(deadline),
        normalizedTask.owner,
        normalizedTask.effortHours,
        normalizedTask.notes,
        normalizedTask.notesAi,
        normalizedTask.parentTaskId,
        null,
        null,
      ],
    );
    const addedEvent = taskAddedScoreEvent({ ownerId: userId(req), taskId: result.rows[0].id });
    const scoreEvent = await pool.query(
      "insert into score_events(owner_id, amount, cause, task_id) values ($1, $2, $3, $4) returning *",
      [addedEvent.ownerId, addedEvent.amount, addedEvent.cause, addedEvent.taskId],
    );
    let taskRow = result.rows[0];
    let syncWarning = null;
    try {
      const smartsheetRowId = await addApprovedTaskToSmartsheet(normalizedTask);
      if (smartsheetRowId) {
        const synced = await pool.query(
          "update tasks set source_kind='smartsheet', source_id=$1, updated_at=now() where id=$2 and owner_id=$3 returning *",
          [String(smartsheetRowId), taskRow.id, userId(req)],
        );
        taskRow = synced.rows[0] || taskRow;
      }
    } catch (error) {
      syncWarning = "Task saved locally, but Smartsheet still needs to be updated";
      await recordSyncException(userId(req), `Task ${taskRow.id}: ${error.message}`);
    }
    res.status(201).json({
      task: serializeTask(taskRow),
      scoreEvent: serializeScoreEvent({
        ...scoreEvent.rows[0],
        title: taskRow.title,
        project: taskRow.project,
      }),
      syncWarning,
    });
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.patch("/api/tasks/:id", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const { title, project, deadline, deadlineKey, owner, effortHours, notes, notesAi, status, blocker } = req.body;
    const found = await pool.query(
      "select * from tasks where id=$1 and owner_id=$2 and status in ('active','blocked')",
      [req.params.id, userId(req)],
    );
    if (!found.rows.length) return res.status(404).json({ error: "Task not found" });
    const current = found.rows[0];
    const nextTask = {
      ...current,
      title: title?.trim() || current.title,
      project: project?.trim() || current.project,
      deadline:
        deadline === undefined && deadlineKey === undefined ? current.deadline : parseDeadline(deadlineKey || deadline),
      owner_name: owner || current.owner_name,
      effort_hours: effortHours === undefined ? current.effort_hours : parseEffort(effortHours),
    };
    const nextStatus = status === "active" || status === "blocked" ? status : undefined;
    const result = await pool.query(
      "update tasks set title=$1, project=$2, deadline=$3, owner_name=$4, effort_hours=$5, notes=$6, notes_ai=$7, status=coalesce($8,status), blocker=case when $9 = '' then null else coalesce($9,blocker) end, updated_at=now() where id=$10 and owner_id=$11 and status in ('active','blocked') returning *",
      [
        nextTask.title,
        nextTask.project,
        nextTask.deadline,
        nextTask.owner_name,
        nextTask.effort_hours,
        notes === undefined ? current.notes : notes,
        notesAi === undefined ? current.notes_ai : Boolean(notesAi),
        nextStatus,
        blocker,
        req.params.id,
        userId(req),
      ],
    );
    if (!result.rows.length) return res.status(409).json({ error: "Task changed before this update could be applied" });
    let syncWarning = null;
    if (current.source_kind === "smartsheet") {
      try {
        await updateSmartsheetTaskFields({
          ...nextTask,
          source_kind: current.source_kind,
          source_id: current.source_id,
        });
      } catch (error) {
        syncWarning = "Task updated locally, but Smartsheet still needs to be updated";
        await recordSyncException(userId(req), `Task ${req.params.id}: ${error.message}`);
      }
    }
    res.json({ ...serializeTask(result.rows[0]), syncWarning });
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

app.post("/api/tasks/:id/complete", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      "select * from tasks where id=$1 and owner_id=$2 and status in ('active','blocked') for update",
      [req.params.id, userId(req)],
    );
    if (!found.rows.length) {
      await client.query("rollback");
      return res.status(404).json({ error: "Task not found" });
    }
    const task = found.rows[0];
    const points = isAnnOwner(task.owner_name) ? effortPoints(task.effort_hours) : 0;
    const completed = await client.query(
      "insert into completed_tasks(owner_id, task_id, title, project, effort_hours, points) values ($1,$2,$3,$4,$5,$6) returning *",
      [userId(req), task.id, task.title, task.project, task.effort_hours, points],
    );
    await client.query("update tasks set status='completed', updated_at=now() where id=$1", [task.id]);
    if (points > 0)
      await client.query("insert into score_events(owner_id, amount, cause, task_id) values ($1,$2,$3,$4)", [
        userId(req),
        points,
        "completed task",
        task.id,
      ]);
    await client.query("commit");
    let syncWarning = null;
    if (task.source_kind === "smartsheet") {
      try {
        await updateSmartsheetTaskStatus(task.source_id, "Done");
      } catch (error) {
        syncWarning = "Task completed locally, but Smartsheet still needs to be updated";
        await recordSyncException(userId(req), `Task ${task.id}: ${error.message}`);
      }
    }
    res.json({
      ...serializeCompleted({ ...completed.rows[0], deadline: task.deadline, owner_name: task.owner_name }),
      syncWarning,
    });
  } catch (error) {
    await client.query("rollback");
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  } finally {
    client.release();
  }
});

app.post("/api/completed/:id/undo", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query(
      "select c.*, t.source_kind, t.source_id from completed_tasks c left join tasks t on t.id=c.task_id where c.id=$1 and c.owner_id=$2 for update of c",
      [req.params.id, userId(req)],
    );
    if (!found.rows.length) {
      await client.query("rollback");
      return res.status(404).json({ error: "Completed task not found" });
    }
    const item = found.rows[0];
    if (item.task_id)
      await client.query("update tasks set status='active', updated_at=now() where id=$1 and owner_id=$2", [
        item.task_id,
        userId(req),
      ]);
    await client.query("delete from score_events where task_id=$1 and owner_id=$2 and cause='completed task'", [
      item.task_id,
      userId(req),
    ]);
    await client.query("delete from completed_tasks where id=$1", [item.id]);
    await client.query("commit");
    if (item.source_kind === "smartsheet") {
      try {
        await updateSmartsheetTaskStatus(item.source_id, "To do");
      } catch (error) {
        await recordSyncException(userId(req), `Task ${item.task_id}: ${error.message}`);
      }
    }
    res.status(204).end();
  } catch (error) {
    await client.query("rollback");
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  } finally {
    client.release();
  }
});

app.post("/api/source-items/:id/approve", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select * from source_items where id=$1 and owner_id=$2 for update", [
      req.params.id,
      userId(req),
    ]);
    if (!found.rows.length) {
      await client.query("rollback");
      return res.status(404).json({ error: "Source item not found" });
    }
    const row = found.rows[0];
    const payload = row.payload || {};
    const decision = sourceItemApprovalDecision(payload, req.body.extractedIndex, req.body.values || {}, {
      timeZone: appTimeZone,
    });
    if (!decision.ok) {
      await client.query("rollback");
      return res.status(400).json({ error: decision.error });
    }
    if (decision.alreadyApproved) {
      await client.query("rollback");
      return res.json({ alreadyApproved: true });
    }
    let response;
    if (decision.isMilestone) {
      const milestone = await client.query(
        "insert into milestones(owner_id, name, milestone_date, project, type) values ($1,$2,$3,$4,$5) returning *",
        [
          userId(req),
          decision.milestone.name,
          decision.milestone.date,
          decision.milestone.project,
          decision.milestone.type,
        ],
      );
      const tasks = await client.query("select * from tasks where owner_id=$1", [userId(req)]);
      response = { kind: "milestone", milestone: serializeMilestone(milestone.rows[0], tasks.rows) };
    } else {
      const { task: approvedTask } = decision;
      const task = await client.query(
        "insert into tasks(owner_id, title, project, deadline, owner_name, effort_hours, notes, notes_ai, source_kind, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *",
        [
          userId(req),
          approvedTask.title,
          approvedTask.project,
          parseDeadline(approvedTask.deadline),
          approvedTask.owner,
          approvedTask.effortHours,
          approvedTask.notes,
          approvedTask.notesAi,
          row.source,
          row.source_id,
        ],
      );
      const addedEvent = taskAddedScoreEvent({ ownerId: userId(req), taskId: task.rows[0].id });
      await client.query("insert into score_events(owner_id, amount, cause, task_id) values ($1, $2, $3, $4)", [
        addedEvent.ownerId,
        addedEvent.amount,
        addedEvent.cause,
        addedEvent.taskId,
      ]);
      response = { kind: "task", task: serializeTask(task.rows[0]) };
    }
    const approved = applySourceItemApproval(payload, decision.index);
    await client.query("update source_items set payload=$1, status=$2, updated_at=now() where id=$3", [
      JSON.stringify(approved.payload),
      approved.status,
      row.id,
    ]);
    await client.query("commit");
    let syncWarning = null;
    if (response.kind === "task") {
      try {
        const approvedTask = decision.task;
        const smartsheetRowId = await addApprovedTaskToSmartsheet({
          title: approvedTask.title,
          project: approvedTask.project,
          deadline: approvedTask.deadline,
          owner: approvedTask.owner,
          effortHours: approvedTask.effortHours,
        });
        if (smartsheetRowId) {
          await pool.query(
            "update tasks set source_kind='smartsheet', source_id=$1, updated_at=now() where id=$2 and owner_id=$3",
            [String(smartsheetRowId), response.task.id, userId(req)],
          );
        }
      } catch (error) {
        syncWarning = "Task approved locally, but Smartsheet still needs to be updated";
        await recordSyncException(userId(req), `Approved task ${response.task.id}: ${error.message}`);
      }
    }
    res.status(201).json({ ...response, syncWarning });
  } catch (error) {
    await client.query("rollback");
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  } finally {
    client.release();
  }
});

app.post("/api/source-items/:id/dismiss", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const found = await pool.query("select payload from source_items where id=$1 and owner_id=$2", [
      req.params.id,
      userId(req),
    ]);
    if (!found.rows.length) return res.status(404).json({ error: "Source item not found" });
    const payload = found.rows[0].payload || {};
    const index = Number(req.body.extractedIndex);
    const dismissed = Array.from(new Set([...(payload.dismissedIndexes || []), index]));
    const extracted = payload.extractedItems || [];
    const status =
      dismissed.length + (payload.approvedIndexes || []).length >= extracted.length ? "dismissed" : "unreviewed";
    await pool.query("update source_items set payload=$1, status=$2, updated_at=now() where id=$3 and owner_id=$4", [
      JSON.stringify({ ...payload, dismissedIndexes: dismissed }),
      status,
      req.params.id,
      userId(req),
    ]);
    res.status(204).end();
  } catch (error) {
    res.status(statusForError(error)).json({ error: errorMessage(error) });
  }
});

async function start() {
  if (pool) {
    try {
      const schemaPath = fileURLToPath(new URL("../database/schema.sql", import.meta.url));
      await pool.query(await readFile(schemaPath, "utf8"));
      const repaired = await pool.query(
        "update milestones set milestone_date=make_date($1, extract(month from milestone_date)::integer, extract(day from milestone_date)::integer), updated_at=now() where milestone_date >= date '2001-01-01' and milestone_date < date '2002-01-01'",
        [Number(todayKey().slice(0, 4))],
      );
      if (repaired.rowCount)
        console.log(`Repaired ${repaired.rowCount} legacy milestone date${repaired.rowCount === 1 ? "" : "s"}`);
      console.log("PostgreSQL schema verified");
    } catch (error) {
      console.error("PostgreSQL schema initialization failed", error.message);
    }
  }
  app.listen(port, () => console.log(`Workboard backend listening on http://localhost:${port}`));
}

start();
