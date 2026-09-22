import assert from "node:assert/strict";
import test from "node:test";
import { dateLabel, dateOnly, effortPoints, parseDeadline, parseEffort } from "../shared/domain.mjs";

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
