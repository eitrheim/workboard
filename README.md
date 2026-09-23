# Workboard

Responsive project-management app for a solo portfolio lead. The UI is organized around these connected views:

- Overview for attention signals and score trends
- Review queue for drafts and unclear items
- Extract tasks for turning a file into quick-approved tasks or review drafts
- Work register for active tasks
- Project view for project-scoped open work, milestones, and completed tasks
- Milestones & deadlines with a timeline and sortable list
- Completed and score view for period summaries and daily score events

## Run the local app

```bash
npm install
npm run dev
```

The app does not seed demo tasks, queue items, or completed records. It opens directly in local app mode. When the local backend and PostgreSQL are available, tasks and planning data persist between sessions.

Use the Extract tasks page for local file-based or pasted-text capture. Extracted items always enter the Review queue before they become work-register tasks or milestones.

Smartsheet can optionally act as the task source of truth. Configure `SMARTSHEET_ACCESS_TOKEN` and `SMARTSHEET_SHEET_ID` in the backend `.env`; the app maps `task`, `Category`, `Due date`, `owner`, `LOE`, and `status`, and uses `SMARTSHEET_APPROVED_STATUS` for approved rows. The Work register Refresh button pulls current Smartsheet rows into PostgreSQL. Approved or edited tasks, completion, and undo actions write back to Smartsheet when a source row exists.

## Run the local backend

```bash
cp .env.example .env
npm run server
```

The backend is a local Express service with PostgreSQL-backed task state, server-side OpenAI extraction, and optional Smartsheet synchronization. Add secrets only to the local `.env` file. See [docs/azure-setup.md](docs/azure-setup.md) and [database/schema.sql](database/schema.sql). The Azure setup guide now documents the local-only configuration; Microsoft Entra and Microsoft Graph are not required.

No credentials are included. The OpenAI and Smartsheet keys stay on the backend and never reach the browser.

## Project relationship migration

Tasks and milestones retain their existing `project` text as a compatibility snapshot while nullable `project_id` foreign keys are introduced. The migration backfills IDs only when the owner and project name match exactly; unmatched legacy names remain available in the text field for review.

- PostgreSQL: restart the local backend so `database/schema.sql` adds and backfills the columns.
- D1/Worker: apply [drizzle/0002_project_relationships.sql](drizzle/0002_project_relationships.sql) once through the Site database migration process before switching writes to ID-only project references.

API responses expose `projectId` when a relationship has been backfilled. The text fields remain intentionally preserved until all legacy records are reconciled.

## Quality checks

```bash
npm run check
```

This runs ESLint, Prettier validation, TypeScript syntax checking, worker tests, and the production build. The same check runs in [GitHub Actions](.github/workflows/quality.yml).
