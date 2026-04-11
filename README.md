# sf-middleware

Standalone Fastify service that sits between Balo's Bubble app and Salesforce.
Bubble fires and forgets; the middleware handles auth, queuing, retries, and logging.

**This is a temporary bridge for the Bubble era only.** It will be decommissioned when
Balo cuts over to the new Next.js / Fastify stack, which calls Salesforce directly from
the Fastify backend with its own token management.

---

## Quick start

```bash
cp .env.example .env          # fill in all values
npm install
npm run build
npm start
```

### Local development

```bash
npm run dev                    # compiles TypeScript + watches for changes
```

Requires a running Redis instance (set `REDIS_URL` in `.env`).

---

## Environment variables

| Variable | Description | Where to find |
|---|---|---|
| `MIDDLEWARE_API_SECRET` | Shared bearer token for Bubble → middleware auth | Generate a strong random string; set in Bubble API Connector |
| `SF_BASE_URL` | Salesforce instance URL | Salesforce Setup → Company Information |
| `SF_API_VERSION` | SF REST API version (e.g. `v65.0`) | Salesforce release notes |
| `SF_CLIENT_ID` | Connected App consumer key | Salesforce Setup → App Manager → Connected App |
| `SF_CLIENT_SECRET` | Connected App consumer secret | Same as above |
| `SF_USERNAME` | Integration user username | Salesforce user management |
| `SF_PASSWORD` | Integration user password (+ security token if required) | Salesforce user management |
| `REDIS_URL` | Redis connection string | Railway Redis plugin dashboard |
| `AXIOM_DATASET` | Axiom dataset name | Axiom dashboard |
| `AXIOM_TOKEN` | Axiom API token | Axiom Settings → API Tokens |
| `AXIOM_ORG_ID` | Axiom organisation ID | Axiom Settings |
| `SLACK_WEBHOOK_ACTIVITY` | Incoming Webhook URL for `#sf-sync-activity` | Slack App → Incoming Webhooks |
| `SLACK_WEBHOOK_ERRORS` | Incoming Webhook URL for `#sf-sync-errors` | Same as above |
| `DIGEST_CRON` | Cron schedule for daily digest (default `0 7 * * *` = 5 PM AEST) | — |
| `BULL_BOARD_USERNAME` | Basic auth username for `/admin/queues` | Set in Railway env vars |
| `BULL_BOARD_PASSWORD` | Basic auth password for `/admin/queues` | Set in Railway env vars |
| `PORT` | Server port (default `3000`) | — |
| `NODE_ENV` | Runtime environment | — |

---

## Route map

### Apex Endpoints (custom Salesforce logic)

| Middleware route | SF target | Method |
|---|---|---|
| `POST /crm/prospect` | `/services/apexrest/Prospect/` | POST |
| `POST /crm/booking` | `/services/apexrest/Booking/` | POST |

### Standard SF Object Upserts (REST API)

| Middleware route | SF target | Method |
|---|---|---|
| `PATCH /crm/lead/:id` | `/services/data/v65.0/sobjects/Lead/Balo_Id__c/:id` | PATCH |
| `PATCH /crm/account/:id` | `/services/data/v65.0/sobjects/Account/Balo_Id__c/:id` | PATCH |
| `PATCH /crm/contact/:id` | `/services/data/v65.0/sobjects/Contact/Balo_Id__c/:id` | PATCH |
| `PATCH /crm/opportunity/case/:id` | `/services/data/v65.0/sobjects/Opportunity/Balo_Case_Number__c/:id` | PATCH |
| `PATCH /crm/opportunity/project/:id` | `/services/data/v65.0/sobjects/Opportunity/Balo_Id__c/:id` | PATCH |
| `PATCH /crm/project-expert/:id` | `/services/data/v65.0/sobjects/Project__c/Balo_Id__c/:id` | PATCH |
| `PATCH /crm/consultation/:id` | `/services/data/v65.0/sobjects/Consultation__c/Balo_Id__c/:id` | PATCH |

### System routes

| Route | Auth | Description |
|---|---|---|
| `GET /health` | None | Returns `200 { status: "ok" }` |
| `GET /admin/queues` | Basic auth | Bull Board queue dashboard |

All CRM routes return `202 Accepted` with `{ accepted: true, jobId: "..." }`.

---

## Bull Board — Queue Admin UI

Once deployed, the queue dashboard is at:

```
https://<railway-url>/admin/queues
```

Log in with `BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD`.

From the UI you can:
- **Inspect** failed jobs — view payload, error message, stack trace, attempt history
- **Retry** a failed job — re-queues it immediately
- **Clean** completed jobs — remove old completed entries
- **Pause / resume** a queue — useful during maintenance or SF downtime

Both queues are visible:
- `sf-forward` — all Salesforce forwarding jobs
- `sf-digest` — the daily summary scheduled job

---

## Decommission plan

This service should be shut down when balo-app cuts over to the new stack. The new Fastify
backend calls Salesforce directly with its own token management. When the time comes:

1. Disable Bubble API calls to this middleware
2. Drain remaining jobs in the `sf-forward` queue
3. Delete the Railway project and its Redis instance
4. Archive this repository
