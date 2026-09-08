# Azure and Microsoft 365 setup

This app uses delegated, read-only Microsoft Graph access on behalf of the signed-in West Monroe user. It does not send mail, edit calendar events, write Teams messages, or modify OneDrive or SharePoint content.

## App registration

1. Register a web application in Microsoft Entra ID in the West Monroe tenant.
2. Add `http://localhost:8787/auth/callback` as a local web redirect URI.
3. Add delegated Microsoft Graph permissions for the sources enabled in v1:
   - `User.Read`
   - `Mail.Read`
   - `Calendars.Read`
   - `Chat.Read`
   - `offline_access`
4. Use the client ID, tenant ID, and secret in a local `.env` file. Never commit `.env` or place secrets in the frontend.

Microsoft Graph uses delegated permissions for requests made on behalf of a signed-in user. Keep the permission set limited to the data the workflow actually needs. See the [Microsoft Graph authentication concepts](https://learn.microsoft.com/en-us/graph/auth/auth-concepts) and [Microsoft Graph scopes guidance](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).

## Local run

```bash
cp .env.example .env
npm run server
```

Create the local PostgreSQL database and apply the schema before starting the backend:

```bash
createdb workboard
psql workboard < database/schema.sql
```

Set these values in `.env`:

```dotenv
DATABASE_URL=postgresql://<local-user>@localhost:5432/workboard
DATABASE_SSL=false
VITE_API_BASE_URL=http://localhost:8787
FRONTEND_ORIGIN=http://localhost:4173
AZURE_TENANT_ID=<west-monroe-tenant-id>
AZURE_CLIENT_ID=<entra-application-client-id>
AZURE_CLIENT_SECRET=<entra-client-secret>
OPENAI_API_KEY=<server-side-openai-key>
OPENAI_MODEL=gpt-5.4-mini
```

The frontend does not use demo data. It remains at the setup gate until PostgreSQL, Microsoft Entra, and OpenAI are configured. After sign-in, use `Sync` to scan the configured Outlook and Teams sources. Each extracted item is stored locally and enters the Review queue; no source item is modified.

## Temporary connector import mode

If Entra approval is still pending, set `LOCAL_CONNECTOR_IMPORT=true` in `.env` and restart the backend. The app will allow the local single-user workflow without Microsoft sign-in. Use `Import connectors` to paste read-only Outlook or Teams results copied from ChatGPT. Workboard will run the server-side OpenAI extraction and place the proposals in the Review queue. This mode is loopback-only, is not automatic synchronization, and should be disabled after Entra is configured.

## Production path

- Host the Node backend on Azure App Service.
- Use Azure Database for PostgreSQL Flexible Server with the SQL in `database/schema.sql`.
- Store secrets in Azure Key Vault or App Service configuration.
- Replace the local in-memory Express session store with a persistent, encrypted session store before production use.
- Add a public HTTPS callback URI and webhook endpoint before enabling Microsoft Graph change notifications.
- Keep the current read-only behavior until West Monroe business, privacy, and compliance requirements are documented.
