# Local backend and Smartsheet setup

This guide replaces the earlier Microsoft Entra setup. The current Workboard app is local-only; it does not use Microsoft Graph, Entra sign-in, Outlook, Teams, or connector import routes.

## Prerequisites

- Node.js 22 or newer
- A local PostgreSQL database
- An OpenAI API key for document and pasted-text extraction
- Optional: a Smartsheet API access token if Smartsheet is the task source of truth

## Configure the backend

From the project directory:

```bash
cp .env.example .env
```

The `cp` command makes a private working copy of the example configuration. Edit `.env` and set:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workboard
DATABASE_SSL=false
OPENAI_API_KEY=your-openai-api-key
SMARTSHEET_ACCESS_TOKEN=your-smartsheet-token
SMARTSHEET_SHEET_ID=your-sheet-id
SMARTSHEET_APPROVED_STATUS=To do
```

`LOCAL_OWNER_ID` is optional. Leave its default value in place when using an existing local database so previously stored rows remain visible.

## Start the app

In one terminal:

```bash
npm run server
```

In another terminal:

```bash
npm run dev
```

The frontend runs at `http://localhost:4173` and the backend runs at `http://localhost:8787`.

The backend applies `database/schema.sql` when it starts. The PostgreSQL role in `DATABASE_URL` must have permission to create or alter the application tables.

## Verify configuration

Open the backend health endpoint:

```bash
curl http://localhost:8787/api/health
```

The response reports whether PostgreSQL, OpenAI, and Smartsheet are configured. A missing Smartsheet token only disables Refresh and Smartsheet write-back; local tasks and extraction still work.

## Smartsheet behavior

The configured sheet is read when you press Refresh in the Work register. The current mapping is:

| Workboard field | Smartsheet column         |
| --------------- | ------------------------- |
| Task name       | `task`                    |
| Project         | `Category`                |
| Deadline        | `Due date`                |
| Owner           | `owner`                   |
| Effort          | `LOE` or `LOE (in hours)` |
| Status          | `status`                  |

Approving a task, creating a task, editing a sourced task, marking it done, and marking it undone write the corresponding row or status back when the task has a Smartsheet source row.

## Production note

The included Express server is intended for local development. For a hosted deployment, use the included Sites Worker deployment path and configure its managed secrets separately. Do not expose `.env`, API keys, or PostgreSQL credentials to the browser.
