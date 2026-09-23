import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appPath = fileURLToPath(new URL("../src/App.jsx", import.meta.url));
const appSource = await readFile(appPath, "utf8");

test("initial loading state is explicit and user-facing", () => {
  assert.match(appSource, /useState\(true\)/);
  assert.match(appSource, /Loading your Workboard/);
  assert.match(appSource, /Fetching your saved tasks and milestones/);
});

test("backend failure has a recoverable error state", () => {
  assert.match(appSource, /setLoadError\(/);
  assert.match(appSource, /We couldn’t load your Workboard data/);
  assert.match(appSource, /Try again/);
  assert.match(appSource, /const retryLoad = async/);
});
