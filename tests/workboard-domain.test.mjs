import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel, dateOnly, effortPoints, parseDeadline, parseEffort } from "../shared/domain.mjs";
import {
  applySourceItemApproval,
  normalizeMilestoneInput,
  sourceItemApprovalDecision,
  validateTaskInput,
} from "../shared/workboard.mjs";
import { buildSmartsheetTaskCells, mapSmartsheetColumns } from "../shared/smartsheet.mjs";

test("shared domain rules preserve dates, decimals, and score thresholds", () => {
  const now = new Date("2026-09-22T18:00:00Z");
  assert.equal(parseDeadline("Today", { timeZone: "America/Los_Angeles", now }), "2026-09-22");
  assert.equal(parseDeadline("09/25/2026", { timeZone: "America/Los_Angeles", now }), "2026-09-25");
  assert.equal(dateOnly("2026-09-25T00:00:00.000Z"), "2026-09-25");
  assert.equal(dateLabel("2026-09-22", { timeZone: "America/Los_Angeles", now }), "Today");
  assert.equal(parseEffort(".5 hrs"), 0.5);
  assert.equal(parseEffort("1.25"), 1.25);
  assert.equal(effortPoints(0.5), 10);
  assert.equal(effortPoints(2), 20);
  assert.equal(effortPoints(4), 40);
});

test("shared workflow rules stay consistent across runtimes", () => {
  const task = validateTaskInput({ title: "Draft update", project: "Pulse", effortHours: ".5", owner: "Ann" });
  assert.equal(task.ok, true);
  assert.equal(task.value.effortHours, 0.5);
  assert.equal(validateTaskInput({ title: "Draft update", project: "Pulse", effortHours: 0 }).ok, false);

  const payload = {
    extractedItems: [{ type: "MILESTONE", title: "Readout", deadline: "09/25/2026", project: "Pulse" }],
  };
  const decision = sourceItemApprovalDecision(payload, 0, {}, { timeZone: "America/Los_Angeles" });
  assert.equal(decision.milestone.date, "2026-09-25");
  assert.deepEqual(applySourceItemApproval(payload, 0).payload.approvedIndexes, [0]);
  assert.deepEqual(normalizeMilestoneInput({ name: "Readout", dateKey: "2026-09-25" }).date, "2026-09-25");

  const columns = [
    { id: 1, title: "Task" },
    { id: 2, title: "Category" },
    { id: 3, title: "Due date" },
    { id: 4, title: "LOE" },
    { id: 5, title: "Status" },
  ];
  const mapped = mapSmartsheetColumns(columns);
  assert.equal(mapped.effort.id, 4);
  assert.deepEqual(
    buildSmartsheetTaskCells(columns, { title: "Draft update", project: "Pulse", effortHours: 0.5, status: "To do" }),
    [
      { columnId: 1, value: "Draft update" },
      { columnId: 2, value: "Pulse" },
      { columnId: 4, value: 0.5 },
      { columnId: 5, value: "To do" },
    ],
  );
});
