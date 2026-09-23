#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const sharedDomain = path.join(root, "shared", "domain.mjs");
const sharedWorkboard = path.join(root, "shared", "workboard.mjs");
const sharedSmartsheet = path.join(root, "shared", "smartsheet.mjs");
const sharedErrors = path.join(root, "shared", "errors.mjs");
const workerDomainShim = path.join(root, "worker", "shared", "domain.mjs");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [
  index,
  worker,
  sharedDomain,
  sharedWorkboard,
  sharedSmartsheet,
  sharedErrors,
  workerDomainShim,
  hosting,
]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, "server", "shared"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(sharedDomain, path.join(dist, "server", "shared", "domain.mjs"));
copyFileSync(sharedWorkboard, path.join(dist, "server", "shared", "workboard.mjs"));
copyFileSync(sharedSmartsheet, path.join(dist, "server", "shared", "smartsheet.mjs"));
copyFileSync(sharedErrors, path.join(dist, "server", "shared", "errors.mjs"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
