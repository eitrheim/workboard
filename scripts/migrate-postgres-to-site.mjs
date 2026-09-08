import "dotenv/config";
import pg from "pg";

const destination = process.env.WORKBOARD_SITE_URL;
const bypassToken = process.env.WORKBOARD_SITE_BYPASS_TOKEN;
if (!process.env.DATABASE_URL || !destination || !bypassToken) throw new Error("DATABASE_URL, WORKBOARD_SITE_URL, and WORKBOARD_SITE_BYPASS_TOKEN are required");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: /(?:localhost|127\.0\.0\.1|::1)/i.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
const tables = ["projects", "tasks", "completed_tasks", "score_events", "source_items", "source_exceptions", "milestones"];
try {
  const payload = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await pool.query(`select * from ${table}`)).rows])));
  const response = await fetch(`${destination.replace(/\/$/, "")}/api/migrate`, { method: "POST", headers: { "content-type": "application/json", "OAI-Sites-Authorization": `Bearer ${bypassToken}` }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Hosted import failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  console.log(JSON.stringify(result.imported));
} finally {
  await pool.end();
}
