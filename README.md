# Workboard

Responsive project-management app for a solo portfolio lead. The UI is organized around four connected views:

- Review queue for drafts, unclear items, and source exceptions
- Extract tasks for turning a file into quick-approved tasks or review drafts
- Work register for active tasks
- Project view for project-scoped open work, milestones, and completed tasks
- Milestones & deadlines with a timeline and sortable list
- *Work plan for deadline and calendar-aware prioritization (removed until live connection can be made to Outlook)* 
- Completed and score view for period summaries and daily score events

## Run the local app

```bash
npm install
npm run dev
```

The app does not seed demo tasks, queue items, or completed records. It opens directly in local app mode; Microsoft Entra, Outlook, Teams, and OpenAI are optional integrations rather than startup requirements. When the local backend and PostgreSQL are available, tasks and planning data persist between sessions.

External connector imports are not part of the local-only app. Use the Extract tasks page for local file-based task capture.

Smartsheet can optionally act as the task source of truth. Configure `SMARTSHEET_ACCESS_TOKEN` and `SMARTSHEET_SHEET_ID` in the backend `.env`; the app maps `task`, `Category`, `Due date`, `owner`, `LOE`, and `status`, and uses `SMARTSHEET_APPROVED_STATUS` for approved rows.

## Run the local backend

```bash
cp .env.example .env
npm run server
```

The backend exposes Microsoft Entra sign-in, read-only Microsoft Graph routes for Outlook email, Outlook calendar, and Teams chats, PostgreSQL-backed task state, and server-side OpenAI extraction. Add secrets only to the local `.env` file. See [docs/azure-setup.md](docs/azure-setup.md) and [database/schema.sql](database/schema.sql).

No credentials are included. Microsoft Graph remains read-only, and the OpenAI key never reaches the browser.
