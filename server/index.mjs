import "isomorphic-fetch";
import dotenv from "dotenv";
import express from "express";
import session from "express-session";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import OpenAI from "openai";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

dotenv.config();

const { Pool } = pg;
const port = Number(process.env.PORT || 8787);
const tenantId = process.env.AZURE_TENANT_ID || "common";
const redirectUri = process.env.AZURE_REDIRECT_URI || `http://localhost:${port}/auth/callback`;
const graphScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Calendars.Read",
  "Chat.Read",
];
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const manualConnectorImportEnabled = process.env.LOCAL_CONNECTOR_IMPORT === "true";
const smartsheetToken = process.env.SMARTSHEET_ACCESS_TOKEN || "";
const smartsheetSheetId = process.env.SMARTSHEET_SHEET_ID || "cfgw3V4qfMwxH8XjPRFQP46p578vm5Fgc3wFGWF1";
const smartsheetApprovedStatus = process.env.SMARTSHEET_APPROVED_STATUS || "To do";

const msal = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || "missing-client-id",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "missing-client-secret",
    authority: `https://login.microsoftonline.com/${tenantId}`,
  },
});

const databaseUrl = process.env.DATABASE_URL || "";
const localDatabase = /(?:localhost|127\.0\.0\.1|::1)/i.test(databaseUrl);
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === "false" || localDatabase ? false : { rejectUnauthorized: false } }) : null;
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
  res.setHeader("Access-Control-Allow-Origin", localFrontendOrigins.has(requestOrigin) ? requestOrigin : frontendOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "local-development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 },
}));

function graphClient(accessToken) {
  return Client.init({ authProvider: (done) => done(null, accessToken) });
}

function requireAuth(req, res, next) {
  if (!req.session.graph) return res.status(401).json({ error: "Microsoft sign-in required", signInUrl: "/auth/signin" });
  next();
}

function isLoopbackRequest(req) {
  return ["localhost", "127.0.0.1", "::1"].includes(req.hostname);
}

function requireAppAccess(req, res, next) {
  if (req.session.graph || (manualConnectorImportEnabled && isLoopbackRequest(req))) return next();
  return res.status(401).json({ error: "Microsoft sign-in required", signInUrl: "/auth/signin" });
}

function requireDatabase(_req, res, next) {
  if (!pool) return res.status(503).json({ error: "Local PostgreSQL is not configured" });
  next();
}

function userId(req) {
  return req.session.graph?.account?.homeAccountId || req.session.graph?.account?.localAccountId || req.session.graph?.account?.username || (manualConnectorImportEnabled && isLoopbackRequest(req) ? "local-connector-import-user" : "microsoft-user");
}

function currentProfile(req) {
  const account = req.session.graph?.account || {};
  return { name: account.name || account.username || (manualConnectorImportEnabled && isLoopbackRequest(req) ? "Local connector import" : "Microsoft 365 user"), email: account.username || (manualConnectorImportEnabled && isLoopbackRequest(req) ? "ChatGPT-connected data" : "") };
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dateKeyFromDate(value);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : parseDeadline(text);
}

function todayKey() {
  return dateKeyFromDate(new Date());
}

function dateKeyFromDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: appTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateLabel(value) {
  const key = dateOnly(value);
  if (!key) return "No deadline";
  const today = todayKey();
  if (key === today) return "Today";
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function effortPoints(hours) {
  const effort = Number(hours) || 1;
  return effort >= 4 ? 40 : effort > 1 ? 20 : 10;
}

function isAnnOwner(owner) {
  return String(owner || "").trim().toLowerCase() === "ann";
}

function parseDeadline(value) {
  const text = String(value ?? "").trim();
  if (!text || /^no deadline$/i.test(text)) return null;
  if (/^today$/i.test(text)) return todayKey();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const normalizedText = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");

  const numericDate = normalizedText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (numericDate) {
    const [, month, day, rawYear] = numericDate;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const candidate = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
    if (candidate.getUTCFullYear() === year && candidate.getUTCMonth() === Number(month) - 1 && candidate.getUTCDate() === Number(day)) return candidate.toISOString().slice(0, 10);
  }

  const hasExplicitYear = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(normalizedText);
  const datedText = hasExplicitYear ? normalizedText : `${normalizedText} ${todayKey().slice(0, 4)}`;
  const parsed = Date.parse(datedText);
  return Number.isNaN(parsed) ? null : dateKeyFromDate(new Date(parsed));
}

function parseEffort(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(?:\d+(?:\.\d+)?|\.\d+)/);
  const effort = match ? Number(match[0]) : Number(value);
  return Number.isFinite(effort) && effort > 0 ? effort : 1;
}

function serializeTask(row) {
  return { id: row.id, title: row.title, project: row.project, deadline: dateLabel(row.deadline), deadlineKey: dateOnly(row.deadline), owner: row.owner_name, effortHours: Number(row.effort_hours), points: [10, 20, 40].includes(Number(row.points)) ? Number(row.points) : effortPoints(Number(row.effort_hours)), status: row.status, blocker: row.blocker || undefined, notes: row.notes || "", notesAi: Boolean(row.notes_ai), parentTaskId: row.parent_task_id || undefined, sourceKind: row.source_kind || undefined };
}

function serializeCompleted(row) {
  return { id: row.id, sourceTaskId: row.task_id, title: row.title, project: row.project, date: dateLabel(row.completed_at), dateKey: dateOnly(row.completed_at), createdAt: row.completed_at, deadline: dateLabel(row.deadline), deadlineKey: dateOnly(row.deadline), owner: row.owner_name || "Unassigned", effortHours: Number(row.effort_hours), points: Number(row.points), day: new Date(row.completed_at).toLocaleDateString("en-US", { weekday: "short" }) };
}

function serializeScoreEvent(row) {
  return { id: row.id, date: dateLabel(row.event_date), dateKey: dateOnly(row.event_date), createdAt: row.created_at, amount: Number(row.amount), cause: row.cause, taskId: row.task_id || undefined, title: row.title || "Task", project: row.project || "Unassigned" };
}

function serializeProject(row) {
  return { id: row.id, name: row.name, status: row.status };
}

async function smartsheetRequest(path, options = {}) {
  if (!smartsheetToken) throw new Error("SMARTSHEET_ACCESS_TOKEN is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SMARTSHEET_TIMEOUT_MS || 10000));
  try {
    const response = await fetch(`https://api.smartsheet.com/2.0${path}`, { ...options, signal: controller.signal, headers: { Authorization: `Bearer ${smartsheetToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`Smartsheet request failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Smartsheet request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function smartsheetCells(row, columns) {
  const values = new Map((row.cells || []).map((cell) => [cell.columnId, cell.displayValue ?? cell.value ?? ""]));
  return Object.fromEntries(columns.map((column) => [String(column.title).toLowerCase(), values.get(column.id) || ""]));
}

async function syncSmartsheetTasks(owner) {
  if (!smartsheetToken) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const columns = sheet.columns || [];
  const column = (title) => columns.find((item) => String(item.title).toLowerCase() === title.toLowerCase());
  const taskColumn = column("task"); const projectColumn = column("Category"); const deadlineColumn = column("Due date"); const ownerColumn = column("owner"); const effortColumn = column("LOE") || column("LOE (in hours)"); const statusColumn = column("status");
  if (!taskColumn) throw new Error("Smartsheet sheet is missing the task column");
  for (const row of sheet.rows || []) {
    const values = smartsheetCells(row, columns); const title = String(values.task || "").trim(); if (!title) continue;
    const sheetStatus = String(values.status || "To do").trim(); const normalizedStatus = /^(done|complete|completed)$/i.test(sheetStatus) ? "completed" : "active";
    const result = await pool.query("insert into tasks(owner_id,title,project,deadline,owner_name,effort_hours,status,source_kind,source_id) values($1,$2,$3,$4,$5,$6,$7,'smartsheet',$8) on conflict (owner_id, source_kind, source_id) where source_kind is not null and source_id is not null do update set title=excluded.title, project=excluded.project, deadline=excluded.deadline, owner_name=excluded.owner_name, effort_hours=excluded.effort_hours, status=case when tasks.status='completed' then tasks.status else excluded.status end, updated_at=now() returning id", [owner, title, String(values.category || "Unassigned") || "Unassigned", parseDeadline(values["due date"]), String(values.owner || "Unassigned") || "Unassigned", parseEffort(values["loe (in hours)"] ?? values.loe), normalizedStatus, String(row.id)]);
    await pool.query("insert into score_events(owner_id, amount, cause, task_id) select $1, $2, $3, $4 where not exists (select 1 from score_events where owner_id=$1 and task_id=$4 and cause=$3)", [owner, 1, "task added", result.rows[0].id]);
  }
  return { rows: sheet.rows?.length || 0, statusColumn: Boolean(statusColumn) };
}

async function addApprovedTaskToSmartsheet(item) {
  if (!smartsheetToken) return null;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`); const columns = sheet.columns || [];
  const byTitle = (...titles) => columns.find((column) => titles.some((title) => String(column.title).trim().toLowerCase() === title.toLowerCase()));
  const fields = [[byTitle("task"), item.title], [byTitle("category"), item.project || "Unassigned"], [byTitle("due date"), item.deadline && item.deadline !== "No deadline" ? parseDeadline(item.deadline) : ""], [byTitle("owner"), item.owner || "Unassigned"], [byTitle("loe", "loe (in hours)"), parseEffort(item.effortHours)], [byTitle("status"), smartsheetApprovedStatus]];
  const cells = fields.flatMap(([column, value]) => column && value !== "" ? [{ columnId: column.id, value }] : []);
  const result = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, { method: "POST", body: JSON.stringify([{ toTop: true, cells }]) });
  return result?.result?.[0]?.id || null;
}

async function updateSmartsheetTaskStatus(sourceId, status) {
  if (!smartsheetToken || !sourceId) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const statusColumn = (sheet.columns || []).find((column) => String(column.title).trim().toLowerCase() === "status");
  if (!statusColumn) throw new Error("Smartsheet sheet is missing the Status column");
  const rowId = /^\d+$/.test(String(sourceId)) ? Number(sourceId) : sourceId;
  await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, {
    method: "PUT",
    body: JSON.stringify([{ id: rowId, cells: [{ columnId: statusColumn.id, value: status }] }]),
  });
}

async function updateSmartsheetTaskFields(task) {
  if (!smartsheetToken || task.source_kind !== "smartsheet" || !task.source_id) return;
  const sheet = await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}`);
  const columns = sheet.columns || [];
  const byTitle = (...titles) => columns.find((column) => titles.some((title) => String(column.title).trim().toLowerCase() === title.toLowerCase()));
  const fields = [
    [byTitle("task"), task.title],
    [byTitle("category"), task.project || "Unassigned"],
    [byTitle("due date"), task.deadline ? dateOnly(task.deadline) : ""],
    [byTitle("owner"), task.owner_name || "Unassigned"],
    [byTitle("loe", "loe (in hours)"), parseEffort(task.effort_hours)],
  ];
  const cells = fields.flatMap(([column, value]) => column && value !== "" ? [{ columnId: column.id, value }] : []);
  if (!cells.length) return;
  const rowId = /^\d+$/.test(String(task.source_id)) ? Number(task.source_id) : task.source_id;
  await smartsheetRequest(`/sheets/${encodeURIComponent(smartsheetSheetId)}/rows`, { method: "PUT", body: JSON.stringify([{ id: rowId, cells }]) });
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
  const projectOptions = Array.isArray(source.projectOptions) ? source.projectOptions.map((project) => String(project).trim()).filter(Boolean).slice(0, 100) : [];
  const projectInstruction = projectOptions.length ? ` Known active projects are: ${projectOptions.map((project) => JSON.stringify(project)).join(", ")}. Project is a closed-list field: assign only one of those exact project names when the source supports it; otherwise return an empty project string. Never invent, normalize, or create a project name.` : " If no known project list is supplied or the source does not clearly identify one, return an empty project string.";
  const response = await openai.responses.create({
    model: openAiModel,
    store: false,
    reasoning: { effort: "medium" },
    instructions: `Read the entire supplied source. Inspect headings, paragraphs, tables, lists, page content, dates, owners, dependencies, and milestone language. Extract every distinct actionable task and meaningful milestone or deadline, including work assigned to anyone, not only the signed-in user. Do not invent facts or duplicate items. Use empty strings for unknown owner or deadline. Use 0 for unknown effortHours. Return concise titles and a short supporting evidence phrase.${projectInstruction}`,
    input: source.dataUrl ? [{ role: "user", content: [{ type: "input_text", text: `Source type: ${source.kind}\nSource label: ${source.label}\nExtracted text, if available:\n${source.content || "(No browser text available; inspect the attached file.)"}` }, ...(source.mimeType?.startsWith("image/") ? [{ type: "input_image", image_url: source.dataUrl, detail: "high" }] : [{ type: "input_file", filename: source.fileName || "uploaded-file", file_data: source.dataUrl }]) ] }] : `Source type: ${source.kind}\nSource label: ${source.label}\nSource content:\n${source.content}`,
    text: { format: { type: "json_schema", name: "work_items", strict: true, schema: extractionSchema } },
  });
  const parsed = JSON.parse(response.output_text || "{\"items\":[]}");
  return Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : [];
}

function serializeMilestone(row, taskRows) {
  const key = dateOnly(row.milestone_date);
  return { id: row.id, name: row.name, date: dateLabel(key), dateKey: key, project: row.project, type: row.type, linkedTaskIds: taskRows.filter((task) => task.project === row.project && ["active", "blocked"].includes(task.status)).map((task) => task.id) };
}

function sourceLabelForMail(message) {
  return `Outlook · from ${message.from?.emailAddress?.name || message.from?.emailAddress?.address || "unknown sender"}`;
}

function normalizeSources({ mail, calendar, teams }) {
  const mailItems = (mail.value || []).map((message) => ({ kind: "outlook", source: "outlook_email", id: message.id, label: sourceLabelForMail(message), content: [`Subject: ${message.subject || "(no subject)"}`, `From: ${message.from?.emailAddress?.address || "unknown"}`, `Received: ${message.receivedDateTime || "unknown"}`, `Body preview: ${message.bodyPreview || ""}`].join("\n") }));
  const calendarItems = (calendar.value || []).map((event) => ({ kind: "outlook_calendar", source: "outlook_calendar", id: event.id, label: `Outlook calendar · ${event.subject || "Untitled event"}`, content: [`Event: ${event.subject || "(untitled)"}`, `Start: ${event.start?.dateTime || "unknown"}`, `End: ${event.end?.dateTime || "unknown"}`, `Location: ${event.location?.displayName || ""}`, `Availability: ${event.showAs || ""}`].join("\n") }));
  const teamItems = (teams.value || []).map((chat) => ({ kind: "teams", source: "teams_chat", id: chat.id, label: "Teams chat", content: [`Chat id: ${chat.id}`, `Last message preview: ${JSON.stringify(chat.lastMessagePreview || {})}`].join("\n") }));
  return [...mailItems, ...calendarItems, ...teamItems];
}

function queueFromSourceRow(row) {
  const payload = row.payload || {};
  const extractedItems = Array.isArray(payload.extractedItems) ? payload.extractedItems : [];
  const approved = new Set(payload.approvedIndexes || []);
  const dismissed = new Set(payload.dismissedIndexes || []);
  return extractedItems.flatMap((item, index) => {
    if (approved.has(index) || dismissed.has(index)) return [];
    const isMilestone = item.type === "MILESTONE";
    const missing = (isMilestone ? [!item.project && "project", !item.deadline && "date"] : [!item.project && "project", !item.owner && "owner", !item.deadline && "deadline"]).filter(Boolean);
    return [{ id: `${row.id}:${index}`, sourceItemId: row.id, extractedIndex: index, type: missing.length ? "unclear" : "draft", itemKind: isMilestone ? "MILESTONE" : "TASK", source: payload.label || row.source, sourceKind: payload.kind === "outlook" ? "outlook" : payload.kind === "teams" ? "teams" : payload.kind === "file" ? "file" : "outlook", title: item.title, project: item.project, owner: item.owner, deadline: item.deadline, deadlineKey: parseDeadline(item.deadline), effortHours: item.effortHours || 1, badge: missing.length ? "Needs input" : "AI drafted", detail: missing.length ? `Missing: ${missing.join(", ")}` : `${isMilestone ? "Milestone" : "Task"}${isMilestone ? "" : ` · ${item.owner}`} · ${item.deadline}` }];
  });
}

async function readLiveState(req) {
  const owner = userId(req);
  if (smartsheetToken) { try { await syncSmartsheetTasks(owner); } catch (error) { console.error("Smartsheet sync failed", error.message); } }
  const [tasks, completed, scoreEvents, sourceItems, exceptions, projects, milestones] = await Promise.all([
    pool.query("select * from tasks where owner_id = $1 and status in ('active', 'blocked') order by deadline nulls last, created_at desc", [owner]),
    pool.query("select c.*, t.deadline, t.owner_name from completed_tasks c left join tasks t on t.id = c.task_id where c.owner_id = $1 order by c.completed_at desc", [owner]),
    pool.query("select e.*, t.title, t.project from score_events e left join tasks t on t.id = e.task_id where e.owner_id = $1 order by e.event_date desc, e.created_at desc", [owner]),
    pool.query("select id, source, payload from source_items where owner_id = $1 and status = 'unreviewed' order by created_at desc", [owner]),
    pool.query("select id, source, message, logged_at from source_exceptions where owner_id = $1 and status = 'open' order by logged_at desc", [owner]),
    pool.query("select id, name, status from projects where owner_id = $1 order by status, name", [owner]),
    pool.query("select * from milestones where owner_id = $1 order by milestone_date, created_at", [owner]),
  ]);
  const queue = sourceItems.rows.flatMap(queueFromSourceRow);
  queue.push(...exceptions.rows.map((item) => ({ id: `exception-${item.id}`, exceptionId: item.id, type: "exception", sourceKind: "exception", source: "Source availability exception", title: item.message, detail: `${item.source} · logged ${dateLabel(item.logged_at)}` })));
  const projectMap = new Map(projects.rows.map((project) => [project.name, serializeProject(project)]));
  [...tasks.rows, ...completed.rows].forEach((row) => {
    if (row.project && !projectMap.has(row.project)) projectMap.set(row.project, { id: "inferred-" + row.project, name: row.project, status: "active" });
  });
  return { tasks: tasks.rows.map(serializeTask), completed: completed.rows.map(serializeCompleted), scoreEvents: scoreEvents.rows.map(serializeScoreEvent), queue, projects: [...projectMap.values()], milestones: milestones.rows.map((row) => serializeMilestone(row, tasks.rows)), profile: currentProfile(req), persistence: "postgres" };
}

async function persistSource(owner, source) {
  const existing = await pool.query("select id from source_items where owner_id = $1 and source = $2 and source_id = $3", [owner, source.source, source.id]);
  if (existing.rows.length) return false;
  const extractedItems = await extractItems(source);
  await pool.query("insert into source_items(owner_id, source, source_id, payload, status) values ($1, $2, $3, $4, $5)", [owner, source.source, source.id, JSON.stringify({ kind: source.kind, label: source.label, extractedItems }), extractedItems.length ? "unreviewed" : "processed"]);
  return true;
}

function normalizeManualImport(body) {
  const sourceChoice = String(body.source || "outlook_email");
  const source = ["outlook_email", "outlook_calendar", "teams_chat"].includes(sourceChoice) ? sourceChoice : "outlook_email";
  const label = source === "teams_chat" ? "Microsoft Teams chat results" : source === "outlook_calendar" ? "Outlook calendar results" : "Outlook email results";
  const content = String(body.content || "").trim();
  if (!content) throw new Error("Paste connector results before importing");
  if (content.length > 150000) throw new Error("Paste is too large; import a smaller connector result set");
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = null; }
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.value) ? parsed.value : null;
  const normalizedContent = records ? records.map((record, index) => `Record ${index + 1}:\n${typeof record === "string" ? record : JSON.stringify(record, null, 2)}`).join("\n\n") : content;
  return { kind: source === "teams_chat" ? "teams" : "outlook", source, id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`, label: `ChatGPT connector · ${label}`, content: normalizedContent };
}

async function recordSourceException(owner, source, error) {
  await pool.query("insert into source_exceptions(owner_id, source, message) values ($1, $2, $3)", [owner, source, error.message || String(error)]);
}

async function getGraphToken(req) {
  if (!req.session.graph) throw new Error("Microsoft sign-in required");
  if (req.session.graph.expiresAt > Date.now() + 60_000) return req.session.graph.accessToken;
  if (!req.session.graph.account) throw new Error("Microsoft session expired; please sign in again");
  const refreshed = await msal.acquireTokenSilent({ account: req.session.graph.account, scopes: graphScopes.filter((scope) => !["openid", "profile", "email"].includes(scope)) });
  req.session.graph.accessToken = refreshed.accessToken;
  req.session.graph.expiresAt = refreshed.expiresOn?.getTime() || Date.now() + 45 * 60 * 1000;
  return refreshed.accessToken;
}

async function graphGet(req, path) {
  const token = await getGraphToken(req);
  return graphClient(token).api(path).get();
}

app.get("/api/health", (_req, res) => res.json({ ok: true, microsoftConfigured: Boolean(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET), manualImportEnabled: manualConnectorImportEnabled, openAiConfigured: Boolean(openai), databaseConfigured: Boolean(pool) }));

app.get("/auth/signin", async (_req, res) => {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET) return res.status(503).send("Azure app registration is not configured. Copy .env.example to .env and add the values.");
  const url = await msal.getAuthCodeUrl({ scopes: graphScopes, redirectUri, prompt: "select_account" });
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const result = await msal.acquireTokenByCode({ code: req.query.code, scopes: graphScopes, redirectUri });
    req.session.graph = { accessToken: result.accessToken, expiresAt: result.expiresOn?.getTime() || Date.now() + 45 * 60 * 1000, account: result.account };
    res.redirect("/");
  } catch (error) {
    console.error("Microsoft callback failed", error);
    res.status(400).send("Microsoft sign-in could not be completed. Check the app registration and redirect URI.");
  }
});

app.post("/auth/signout", (req, res) => req.session.destroy(() => res.status(204).end()));

app.get("/api/me", requireAuth, async (req, res) => { try { res.json(await graphGet(req, "/me?$select=id,displayName,mail,userPrincipalName")); } catch (error) { res.status(502).json({ error: error.message }); } });
app.get("/api/graph/mail", requireAuth, async (req, res) => { try { res.json(await graphGet(req, "/me/mailFolders/inbox/messages?$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink&$orderby=receivedDateTime%20DESC")); } catch (error) { res.status(502).json({ error: error.message }); } });
app.get("/api/graph/calendar", requireAuth, async (req, res) => { try { const start = encodeURIComponent(req.query.start || new Date().toISOString()); const end = encodeURIComponent(req.query.end || new Date(Date.now() + 86_400_000).toISOString()); res.json(await graphGet(req, `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=100&$select=id,subject,start,end,isAllDay,showAs,location`)); } catch (error) { res.status(502).json({ error: error.message }); } });
app.get("/api/graph/teams", requireAuth, async (req, res) => { try { res.json(await graphGet(req, "/me/chats?$top=25&$expand=members,lastMessagePreview")); } catch (error) { res.status(502).json({ error: error.message }); } });
app.get("/api/graph/files", requireAuth, async (req, res) => { try { res.json(await graphGet(req, "/me/drive/root/children?$top=50&$select=id,name,file,folder,lastModifiedDateTime,webUrl")); } catch (error) { res.status(502).json({ error: error.message }); } });

app.post("/api/sync", requireAuth, requireDatabase, async (req, res) => {
  if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
  const owner = userId(req);
  const sourceRequests = [
    ["Outlook email", graphGet(req, "/me/mailFolders/inbox/messages?$top=50&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink&$orderby=receivedDateTime%20DESC")],
    ["Outlook calendar", graphGet(req, "/me/calendarView?startDateTime=" + encodeURIComponent(new Date().toISOString()) + "&endDateTime=" + encodeURIComponent(new Date(Date.now() + 14 * 86_400_000).toISOString()) + "&$top=100&$select=id,subject,start,end,isAllDay,showAs,location")],
    ["Teams chats", graphGet(req, "/me/chats?$top=50&$expand=lastMessagePreview")],
  ];
  const settled = await Promise.allSettled(sourceRequests.map(([, request]) => request));
  const [mailResult, calendarResult, teamsResult] = settled;
  const responses = { mail: mailResult.status === "fulfilled" ? mailResult.value : { value: [] }, calendar: calendarResult.status === "fulfilled" ? calendarResult.value : { value: [] }, teams: teamsResult.status === "fulfilled" ? teamsResult.value : { value: [] } };
  for (const [index, result] of settled.entries()) if (result.status === "rejected") await recordSourceException(owner, sourceRequests[index][0], result.reason);
  const sources = normalizeSources(responses);
  let newSources = 0;
  for (const source of sources) {
    try { if (await persistSource(owner, source)) newSources += 1; } catch (error) { await recordSourceException(owner, source.label, error); }
  }
  const state = await readLiveState(req);
  res.json({ syncedAt: new Date().toISOString(), sources: { mail: responses.mail.value?.length || 0, calendar: responses.calendar.value?.length || 0, teams: responses.teams.value?.length || 0 }, calendarEvents: responses.calendar.value || [], newSources, writeBack: false, state });
});

app.get("/api/state", requireAppAccess, requireDatabase, async (req, res) => {
  try { res.json(await readLiveState(req)); } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post("/api/manual-import", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    if (!manualConnectorImportEnabled) return res.status(403).json({ error: "Manual connector import is not enabled" });
    if (!openai) return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    const source = normalizeManualImport(req.body || {});
    const extractedItems = await extractItems(source);
    await pool.query("insert into source_items(owner_id, source, source_id, payload, status) values ($1, $2, $3, $4, $5)", [userId(req), source.source, source.id, JSON.stringify({ kind: source.kind, label: source.label, extractedItems }), extractedItems.length ? "unreviewed" : "processed"]);
    const state = await readLiveState(req);
    res.status(201).json({ source: source.label, extracted: extractedItems.length, state });
  } catch (error) { res.status(502).json({ error: error.message || "Manual connector import failed" }); }
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
    const source = { kind: "file", source: "file_upload", id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`, label: `Dropped file · ${fileName}`, content, dataUrl, mimeType, fileName, projectOptions };
    const extractedItems = await extractItems(source);
    const inserted = await pool.query("insert into source_items(owner_id, source, source_id, payload, status) values ($1, $2, $3, $4, $5) returning id", [userId(req), source.source, source.id, JSON.stringify({ kind: source.kind, label: source.label, extractedItems }), extractedItems.length ? "unreviewed" : "processed"]);
    const sourceItemId = inserted.rows[0].id;
    res.status(201).json({ sourceItemId, items: extractedItems.map((item, index) => ({ ...item, id: `${sourceItemId}:${index}`, dateLabel: item.deadline || "", dateKey: parseDeadline(item.deadline), sourceItemId, extractedIndex: index })) });
  } catch (error) { res.status(502).json({ error: error.message || "File extraction failed" }); }
});

app.post("/api/milestones", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim(); const project = String(req.body.project || "Unassigned").trim(); const date = parseDeadline(req.body.date || req.body.dateKey); const type = req.body.type === "Deadline" ? "Deadline" : "Milestone";
    if (!name || !date) return res.status(400).json({ error: "Milestone name and date are required" });
    const result = await pool.query("insert into milestones(owner_id, name, milestone_date, project, type) values ($1,$2,$3,$4,$5) returning *", [userId(req), name, date, project, type]);
    const tasks = await pool.query("select id, project, status from tasks where owner_id=$1 and status in ('active','blocked')", [userId(req)]);
    res.status(201).json(serializeMilestone(result.rows[0], tasks.rows));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.patch("/api/milestones/:id", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim(); const project = String(req.body.project || "Unassigned").trim(); const date = parseDeadline(req.body.dateKey || req.body.date); const type = req.body.type === "Deadline" ? "Deadline" : "Milestone";
    if (!name || !date) return res.status(400).json({ error: "Milestone name and date are required" });
    const result = await pool.query("update milestones set name=$1, milestone_date=$2, project=$3, type=$4, updated_at=now() where id=$5 and owner_id=$6 returning *", [name, date, project, type, req.params.id, userId(req)]);
    if (!result.rows.length) return res.status(404).json({ error: "Milestone not found" });
    const tasks = await pool.query("select id, project, status from tasks where owner_id=$1 and status in ('active','blocked')", [userId(req)]);
    res.json(serializeMilestone(result.rows[0], tasks.rows));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post("/api/projects", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Project name is required" });
    const result = await pool.query("insert into projects(owner_id, name) values ($1, $2) on conflict(owner_id, name) do update set status='active', updated_at=now() returning id, name, status", [userId(req), name]);
    res.status(201).json(serializeProject(result.rows[0]));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.patch("/api/projects/:name", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    const status = req.body.status;
    if (!name || !["active", "finished"].includes(status)) return res.status(400).json({ error: "Project name and valid status are required" });
    const result = await pool.query("insert into projects(owner_id, name, status) values ($1, $2, $3) on conflict(owner_id, name) do update set status=excluded.status, updated_at=now() returning id, name, status", [userId(req), name, status]);
    res.json(serializeProject(result.rows[0]));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post("/api/tasks", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const { title, project, deadline, owner, effortHours, notes, notesAi, parentTaskId } = req.body;
    if (!title?.trim() || !project?.trim() || !(Number(effortHours) > 0)) return res.status(400).json({ error: "Title, project, and positive effort are required" });
    const normalizedTask = { title: title.trim(), project: project.trim(), deadline, owner: owner || "Unassigned", effortHours: parseEffort(effortHours) };
    const smartsheetRowId = await addApprovedTaskToSmartsheet(normalizedTask);
    const result = await pool.query("insert into tasks(owner_id, title, project, deadline, owner_name, effort_hours, notes, notes_ai, parent_task_id, source_kind, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *", [userId(req), normalizedTask.title, normalizedTask.project, parseDeadline(deadline), normalizedTask.owner, normalizedTask.effortHours, notes || "", Boolean(notesAi), parentTaskId || null, smartsheetRowId ? "smartsheet" : null, smartsheetRowId ? String(smartsheetRowId) : null]);
    const scoreEvent = await pool.query("insert into score_events(owner_id, amount, cause, task_id) values ($1, $2, $3, $4) returning *", [userId(req), 1, "task added", result.rows[0].id]);
    res.status(201).json({ task: serializeTask(result.rows[0]), scoreEvent: serializeScoreEvent({ ...scoreEvent.rows[0], title: result.rows[0].title, project: result.rows[0].project }) });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.patch("/api/tasks/:id", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const { title, project, deadline, deadlineKey, owner, effortHours, notes, notesAi, status, blocker } = req.body;
    const found = await pool.query("select * from tasks where id=$1 and owner_id=$2 and status in ('active','blocked')", [req.params.id, userId(req)]);
    if (!found.rows.length) return res.status(404).json({ error: "Task not found" });
    const current = found.rows[0];
    const nextTask = { ...current, title: title?.trim() || current.title, project: project?.trim() || current.project, deadline: deadline === undefined && deadlineKey === undefined ? current.deadline : parseDeadline(deadlineKey || deadline), owner_name: owner || current.owner_name, effort_hours: effortHours === undefined ? current.effort_hours : parseEffort(effortHours) };
    const nextStatus = status === "active" || status === "blocked" ? status : undefined;
    if (current.source_kind === "smartsheet") await updateSmartsheetTaskFields(nextTask);
    const result = await pool.query("update tasks set title=$1, project=$2, deadline=$3, owner_name=$4, effort_hours=$5, notes=$6, notes_ai=$7, status=coalesce($8,status), blocker=case when $9 = '' then null else coalesce($9,blocker) end, updated_at=now() where id=$10 and owner_id=$11 and status in ('active','blocked') returning *", [nextTask.title, nextTask.project, nextTask.deadline, nextTask.owner_name, nextTask.effort_hours, notes || "", Boolean(notesAi), nextStatus, blocker, req.params.id, userId(req)]);
    res.json(serializeTask(result.rows[0]));
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post("/api/tasks/:id/complete", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select * from tasks where id=$1 and owner_id=$2 and status in ('active','blocked') for update", [req.params.id, userId(req)]);
    if (!found.rows.length) { await client.query("rollback"); return res.status(404).json({ error: "Task not found" }); }
    const task = found.rows[0];
    if (task.source_kind === "smartsheet") await updateSmartsheetTaskStatus(task.source_id, "Done");
    const points = isAnnOwner(task.owner_name) ? effortPoints(task.effort_hours) : 0;
    const completed = await client.query("insert into completed_tasks(owner_id, task_id, title, project, effort_hours, points) values ($1,$2,$3,$4,$5,$6) returning *", [userId(req), task.id, task.title, task.project, task.effort_hours, points]);
    await client.query("update tasks set status='completed', updated_at=now() where id=$1", [task.id]);
    if (points > 0) await client.query("insert into score_events(owner_id, amount, cause, task_id) values ($1,$2,$3,$4)", [userId(req), points, "completed task", task.id]);
    await client.query("commit");
    res.json(serializeCompleted({ ...completed.rows[0], deadline: task.deadline, owner_name: task.owner_name }));
  } catch (error) { await client.query("rollback"); res.status(502).json({ error: error.message }); } finally { client.release(); }
});

app.post("/api/completed/:id/undo", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select c.*, t.source_kind, t.source_id from completed_tasks c left join tasks t on t.id=c.task_id where c.id=$1 and c.owner_id=$2 for update of c", [req.params.id, userId(req)]);
    if (!found.rows.length) { await client.query("rollback"); return res.status(404).json({ error: "Completed task not found" }); }
    const item = found.rows[0];
    if (item.source_kind === "smartsheet") await updateSmartsheetTaskStatus(item.source_id, "To do");
    if (item.task_id) await client.query("update tasks set status='active', updated_at=now() where id=$1 and owner_id=$2", [item.task_id, userId(req)]);
    await client.query("delete from score_events where task_id=$1 and owner_id=$2 and cause='completed task'", [item.task_id, userId(req)]);
    await client.query("delete from completed_tasks where id=$1", [item.id]);
    await client.query("commit");
    res.status(204).end();
  } catch (error) { await client.query("rollback"); res.status(502).json({ error: error.message }); } finally { client.release(); }
});

app.post("/api/source-items/:id/approve", requireAppAccess, requireDatabase, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select * from source_items where id=$1 and owner_id=$2 for update", [req.params.id, userId(req)]);
    if (!found.rows.length) { await client.query("rollback"); return res.status(404).json({ error: "Source item not found" }); }
    const row = found.rows[0]; const payload = row.payload || {}; const index = Number(req.body.extractedIndex); const item = payload.extractedItems?.[index];
    if (!item) { await client.query("rollback"); return res.status(400).json({ error: "Extracted item not found" }); }
    const values = req.body.values || {}; const title = values.title || item.title; const project = values.project || item.project || "Unassigned"; const deadline = values.deadline || item.deadline || "No deadline"; const isMilestone = item.type === "MILESTONE" || values.itemKind === "MILESTONE";
    let response;
    if (isMilestone) {
      const milestoneDate = parseDeadline(deadline);
      if (!title || !milestoneDate) { await client.query("rollback"); return res.status(400).json({ error: "A milestone name and date are required" }); }
      const milestoneType = values.milestoneType === "Deadline" ? "Deadline" : "Milestone";
      const milestone = await client.query("insert into milestones(owner_id, name, milestone_date, project, type) values ($1,$2,$3,$4,$5) returning *", [userId(req), title, milestoneDate, project, milestoneType]);
      const tasks = await client.query("select * from tasks where owner_id=$1", [userId(req)]);
      response = { kind: "milestone", milestone: serializeMilestone(milestone.rows[0], tasks.rows) };
    } else {
      const ownerName = values.owner || item.owner || "Unassigned"; const effortHours = Number(values.effortHours || item.effortHours) || 1; const notes = values.notes || item.evidence || "";
      const smartsheetRowId = await addApprovedTaskToSmartsheet({ title, project, deadline, owner: ownerName, effortHours });
      const task = await client.query("insert into tasks(owner_id, title, project, deadline, owner_name, effort_hours, notes, notes_ai, source_kind, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *", [userId(req), title, project, parseDeadline(deadline), ownerName, effortHours, notes, Boolean(notes), smartsheetRowId ? "smartsheet" : row.source, smartsheetRowId ? String(smartsheetRowId) : row.source_id]);
      await client.query("insert into score_events(owner_id, amount, cause, task_id) values ($1, $2, $3, $4)", [userId(req), 1, "task added", task.rows[0].id]);
      response = { kind: "task", task: serializeTask(task.rows[0]) };
    }
    const approved = Array.from(new Set([...(payload.approvedIndexes || []), index])); const extracted = payload.extractedItems || []; const status = approved.length + (payload.dismissedIndexes || []).length >= extracted.length ? "approved" : "unreviewed";
    await client.query("update source_items set payload=$1, status=$2, updated_at=now() where id=$3", [JSON.stringify({ ...payload, approvedIndexes: approved }), status, row.id]);
    await client.query("commit");
    res.status(201).json(response);
  } catch (error) { await client.query("rollback"); res.status(502).json({ error: error.message }); } finally { client.release(); }
});

app.post("/api/source-items/:id/dismiss", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const found = await pool.query("select payload from source_items where id=$1 and owner_id=$2", [req.params.id, userId(req)]);
    if (!found.rows.length) return res.status(404).json({ error: "Source item not found" });
    const payload = found.rows[0].payload || {}; const index = Number(req.body.extractedIndex); const dismissed = Array.from(new Set([...(payload.dismissedIndexes || []), index])); const extracted = payload.extractedItems || []; const status = dismissed.length + (payload.approvedIndexes || []).length >= extracted.length ? "dismissed" : "unreviewed";
    await pool.query("update source_items set payload=$1, status=$2, updated_at=now() where id=$3 and owner_id=$4", [JSON.stringify({ ...payload, dismissedIndexes: dismissed }), status, req.params.id, userId(req)]);
    res.status(204).end();
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post("/api/source-exceptions/:id/dismiss", requireAppAccess, requireDatabase, async (req, res) => {
  try {
    const result = await pool.query("update source_exceptions set status='dismissed', resolved_at=now() where id=$1 and owner_id=$2 returning id", [req.params.id, userId(req)]);
    if (!result.rows.length) return res.status(404).json({ error: "Source exception not found" });
    res.status(204).end();
  } catch (error) { res.status(502).json({ error: error.message }); }
});

async function start() {
  if (pool) {
    try {
      const schemaPath = fileURLToPath(new URL("../database/schema.sql", import.meta.url));
      await pool.query(await readFile(schemaPath, "utf8"));
      const repaired = await pool.query("update milestones set milestone_date=make_date($1, extract(month from milestone_date)::integer, extract(day from milestone_date)::integer), updated_at=now() where milestone_date >= date '2001-01-01' and milestone_date < date '2002-01-01'", [Number(todayKey().slice(0, 4))]);
      if (repaired.rowCount) console.log(`Repaired ${repaired.rowCount} legacy milestone date${repaired.rowCount === 1 ? "" : "s"}`);
      console.log("PostgreSQL schema verified");
    } catch (error) {
      console.error("PostgreSQL schema initialization failed", error.message);
    }
  }
  app.listen(port, () => console.log(`Workboard backend listening on http://localhost:${port}`));
}

start();
