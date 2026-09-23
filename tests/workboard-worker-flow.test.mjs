import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../worker/index.js";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id, name));
    CREATE TABLE tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, project TEXT NOT NULL, project_id TEXT REFERENCES projects(id), deadline TEXT, owner_name TEXT NOT NULL, effort_hours REAL NOT NULL, status TEXT NOT NULL, blocker TEXT, notes TEXT NOT NULL DEFAULT '', notes_ai INTEGER NOT NULL DEFAULT 0, parent_task_id TEXT, recurring_task_id TEXT, source_kind TEXT, source_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(owner_id, source_kind, source_id));
    CREATE TABLE recurring_tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, project TEXT NOT NULL, owner_name TEXT NOT NULL, effort_hours REAL NOT NULL, weekday INTEGER NOT NULL, active INTEGER NOT NULL, last_created_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE completed_tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, task_id TEXT, title TEXT NOT NULL, project TEXT NOT NULL, completed_at TEXT NOT NULL, effort_hours REAL NOT NULL, points INTEGER NOT NULL);
    CREATE TABLE score_events (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, event_date TEXT NOT NULL, amount INTEGER NOT NULL, cause TEXT NOT NULL, task_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE source_items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT, payload TEXT NOT NULL, status TEXT NOT NULL, file_key TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE milestones (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, milestone_date TEXT NOT NULL, project TEXT NOT NULL, project_id TEXT REFERENCES projects(id), type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = database.prepare(sql);
          return {
            async all() {
              return { results: statement.all(...values) };
            },
            async first() {
              return statement.get(...values) ?? null;
            },
            async run() {
              return statement.run(...values);
            },
          };
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
    raw: database,
  };
}

function jsonRequest(path, method, body) {
  return new Request(`https://workboard.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(response) {
  return response.json();
}

function seedSourceItem(DB, id, extractedItems) {
  const timestamp = new Date().toISOString();
  DB.raw
    .prepare(
      "INSERT INTO source_items(id,owner_id,source,source_id,payload,status,file_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "site-owner",
      "Pasted text.md",
      id,
      JSON.stringify({ extractedItems }),
      "unreviewed",
      null,
      timestamp,
      timestamp,
    );
}

test("task create, completion, undo, and task-added score events stay consistent", async () => {
  const DB = createDatabase();
  const env = { DB };
  const createdResponse = await worker.fetch(
    jsonRequest("/api/tasks", "POST", { title: "Write test plan", project: "Pulse", owner: "Ann", effortHours: ".5" }),
    env,
  );
  assert.equal(createdResponse.status, 201);
  const created = await readJson(createdResponse);
  assert.equal(created.task.effortHours, 0.5);
  assert.equal(created.scoreEvent.amount, 1);

  const initialState = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), env));
  assert.equal(initialState.tasks.length, 1);
  assert.equal(initialState.scoreEvents.filter((event) => event.cause === "task added").length, 1);

  const completedResponse = await worker.fetch(jsonRequest(`/api/tasks/${created.task.id}/complete`, "POST"), env);
  assert.equal(completedResponse.status, 200);
  const completed = await readJson(completedResponse);
  assert.equal(completed.points, 10);

  const completedState = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), env));
  assert.equal(completedState.tasks.length, 0);
  assert.equal(completedState.completed.length, 1);
  assert.equal(completedState.completed[0].points, 10);
  assert.equal(completedState.scoreEvents.filter((event) => event.cause === "completed task").length, 1);

  const undoneResponse = await worker.fetch(jsonRequest(`/api/completed/${completed.id}/undo`, "POST"), env);
  assert.equal(undoneResponse.status, 204);
  const undoneState = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), env));
  assert.equal(undoneState.tasks.length, 1);
  assert.equal(undoneState.completed.length, 0);
  assert.equal(undoneState.scoreEvents.filter((event) => event.cause === "completed task").length, 0);
  assert.equal(undoneState.scoreEvents.filter((event) => event.cause === "task added").length, 1);
});

test("Smartsheet sync is explicit and backfills completed history once", async () => {
  const DB = createDatabase();
  const env = { DB, SMARTSHEET_ACCESS_TOKEN: "test-token", SMARTSHEET_SHEET_ID: "sheet-1" };
  const originalFetch = globalThis.fetch;
  let sheetReads = 0;
  globalThis.fetch = async () => {
    sheetReads += 1;
    return new Response(
      JSON.stringify({
        columns: [
          { id: 1, title: "task" },
          { id: 2, title: "Category" },
          { id: 3, title: "Due date" },
          { id: 4, title: "owner" },
          { id: 5, title: "LOE" },
          { id: 6, title: "status" },
        ],
        rows: [
          {
            id: 42,
            cells: [
              { columnId: 1, value: "Imported completed task" },
              { columnId: 2, value: "Pulse" },
              { columnId: 4, value: "Ann" },
              { columnId: 5, value: 2 },
              { columnId: 6, value: "Done" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    await worker.fetch(new Request("https://workboard.test/api/state"), env);
    assert.equal(sheetReads, 0, "reading state must not trigger an external sync");

    const firstSync = await worker.fetch(jsonRequest("/api/sync", "POST"), env);
    assert.equal(firstSync.status, 200);
    const firstState = await readJson(firstSync);
    assert.equal(firstState.tasks.length, 0);
    assert.equal(firstState.completed.length, 1);
    assert.equal(firstState.completed[0].title, "Imported completed task");
    assert.equal(firstState.scoreEvents.filter((event) => event.cause === "completed task").length, 1);

    const secondSync = await worker.fetch(jsonRequest("/api/sync", "POST"), env);
    assert.equal(secondSync.status, 200);
    const secondState = await readJson(secondSync);
    assert.equal(secondState.completed.length, 1);
    assert.equal(secondState.scoreEvents.filter((event) => event.cause === "completed task").length, 1);
    assert.equal(sheetReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("milestone approval creates a milestone and removes it from the queue", async () => {
  const DB = createDatabase();
  seedSourceItem(DB, "source-milestone", [
    {
      type: "MILESTONE",
      title: "Pulse readout",
      project: "Pulse",
      owner: "",
      deadline: "2026-09-25",
      effortHours: 0,
      evidence: "Readout date appears in the project plan.",
    },
  ]);

  const before = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), { DB }));
  assert.equal(before.queue.length, 1);
  assert.equal(before.queue[0].itemKind, "MILESTONE");

  const response = await worker.fetch(
    jsonRequest("/api/source-items/source-milestone/approve", "POST", {
      extractedIndex: 0,
      values: { itemKind: "MILESTONE", title: "Pulse readout", project: "Pulse", deadline: "2026-09-25" },
    }),
    { DB },
  );
  assert.equal(response.status, 201);

  const after = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), { DB }));
  assert.equal(after.milestones.length, 1);
  assert.equal(after.milestones[0].name, "Pulse readout");
  assert.equal(after.milestones[0].dateKey, "2026-09-25");
  assert.equal(after.queue.length, 0);
});

test("repeated extracted-task approval is idempotent and does not duplicate queue work", async () => {
  const DB = createDatabase();
  seedSourceItem(DB, "source-task", [
    {
      type: "TASK",
      title: "Send the follow-up",
      project: "Pulse",
      owner: "Ann",
      deadline: "2026-09-24",
      effortHours: 0.5,
      evidence: "Follow-up requested in the notes.",
    },
  ]);
  const request = () =>
    worker.fetch(
      jsonRequest("/api/source-items/source-task/approve", "POST", {
        extractedIndex: 0,
        values: { itemKind: "TASK", title: "Send the follow-up", project: "Pulse", owner: "Ann", effortHours: ".5" },
      }),
      { DB },
    );

  const first = await request();
  assert.equal(first.status, 201);
  const second = await request();
  assert.equal(second.status, 200);
  assert.equal((await readJson(second)).alreadyApproved, true);

  const state = await readJson(await worker.fetch(new Request("https://workboard.test/api/state"), { DB }));
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].effortHours, 0.5);
  assert.equal(state.queue.length, 0);
  assert.equal(state.scoreEvents.filter((event) => event.cause === "task added").length, 1);
});

test("Smartsheet refresh imports active task fields and preserves decimal effort", async () => {
  const DB = createDatabase();
  const env = { DB, SMARTSHEET_ACCESS_TOKEN: "test-token", SMARTSHEET_SHEET_ID: "sheet-1" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        columns: [
          { id: 1, title: "task" },
          { id: 2, title: "Category" },
          { id: 3, title: "Due date" },
          { id: 4, title: "owner" },
          { id: 5, title: "LOE" },
          { id: 6, title: "status" },
        ],
        rows: [
          {
            id: 77,
            cells: [
              { columnId: 1, value: "Review API keys" },
              { columnId: 2, value: "WM Internal" },
              { columnId: 3, value: "2026-09-24" },
              { columnId: 4, value: "Ann" },
              { columnId: 5, value: ".5" },
              { columnId: 6, value: "To do" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const response = await worker.fetch(jsonRequest("/api/sync", "POST"), env);
    assert.equal(response.status, 200);
    const state = await readJson(response);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.tasks[0].title, "Review API keys");
    assert.equal(state.tasks[0].project, "WM Internal");
    assert.equal(state.tasks[0].deadlineKey, "2026-09-24");
    assert.equal(state.tasks[0].effortHours, 0.5);
    assert.equal(state.tasks[0].owner, "Ann");
    assert.equal(state.tasks[0].status, "active");
    assert.equal(state.scoreEvents.filter((event) => event.cause === "task added").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
