# Fibery Workspace Setup

The canonical Jacarenda Labs business state lives in Fibery at
[`jacarendalabs.fibery.io`](https://jacarendalabs.fibery.io). Vellum agents
read from and write to it via the API; it's the org knowledge base. Agent
*config* stays in the gateway's local DB — do not mirror it into Fibery.

This doc covers how to set the workspace up from scratch.

## Architecture

**11 spaces, ~38 types, ~34 relations.**

| Space | Types |
|---|---|
| **Brand** | Brand, Audience Segment |
| **Services** | Service Line, Engagement, Deliverable, Session, Time Entry |
| **Marketing** | Campaign, Content, Channel Performance, Case Study, Testimonial, Press Mention |
| **CRM** | Company, Contact, Lead, Opportunity |
| **Accounting** | Invoice, Expense, Revenue Record, Vendor, Subscription |
| **Product and Web** | Property, Feature, Release, Bug |
| **Support** | Ticket, Reply, Knowledge Article, Known Issue |
| **Operations** | SOP, Decision Log, Meeting Note |
| **People** | Team Member |
| **Strategy** | Objective, Key Result, Metric, Metric Reading |
| **Legal and Contracts** | Contract, Legal Document |

Relations wire the spaces together (e.g. Campaign ↔ Service Line, Invoice ↔
Company, Ticket ↔ Contact, Content ↔ Campaign). See
`scripts/setup-fibery-marketing.py` for the full list.

**Seeded entities** (empty husks you fill in):
- `Brand/Brand`: Jacarenda Labs
- `Services/Service Line`: Consultancy · Advisory · Development · Training
- `Product and Web/Property`: jacarendalabs.com · Vellum (assistant.jacarendalabs.com)

## First-time setup

### 1. Prerequisites

- Fibery workspace must exist (we use `jacarendalabs.fibery.io`)
- An API token generated in Fibery: avatar → *Settings → API Tokens → Create*
- Token + workspace URL stashed on the gateway as Fly secrets:
  ```bash
  printf 'FIBERY_WORKSPACE_URL=https://jacarendalabs.fibery.io\nFIBERY_API_TOKEN=<token>\n' | \
    flyctl secrets import --app vellum-gateway
  ```

### 2. Manual steps in Fibery UI

Fibery's API does **not** allow programmatic creation of new custom spaces,
only types/fields within spaces that already exist. So:

**a) Delete the default *Experimental Lab* template** (if present):
Settings → Spaces → hover *Experimental Lab* → **⋮** → **Delete space**.

**b) Create 11 empty spaces** — sidebar `+` next to "Spaces" → **Blank
space** → name it. Exact names (case and spaces matter):

```
Brand
Services
Marketing
CRM
Accounting
Product and Web
Support
Operations
People
Strategy
Legal and Contracts
```

### 3. Run the scaffold script

```bash
FIBERY_WORKSPACE_URL=https://jacarendalabs.fibery.io \
FIBERY_API_TOKEN=<token> \
python3 scripts/setup-fibery-marketing.py
```

The script:
1. Validates all 11 spaces exist (fails fast listing any missing).
2. Creates all 38 types with their custom fields + the 5 mandatory primitive
   fields (`name`, `id`, `public-id`, `creation-date`, `modification-date`).
3. Creates the ~34 paired-field relations between types (shared UUID).
4. Seeds the 6 starter entities.

It is **idempotent** — re-run safely after any UI edit.

### 4. Register webhooks

For each database where you want agents to react to changes: *Settings →
Webhooks → Add Webhook → URL*:

```
https://assistant.jacarendalabs.com/webhooks/fibery
```

Start with the Social Media Manager's working set: **Brand, Service Line,
Campaign, Content, Case Study, Testimonial, Press Mention, Channel
Performance**. Add others as more agents come online.

> The receiver route is not yet built — webhooks registered now will 404
> until Phase 2 of the agent platform ships.

## Extending

- **Adding a new type**: edit the `TYPES` dict in `scripts/setup-fibery-marketing.py` and re-run.
- **Adding a relation**: append to `RELATIONS` and re-run.
- **Adding a new space**: create it in the Fibery UI first (manual), then
  add types in the script.
- **Workflow states**: currently modelled as plain text fields (`Status`,
  `State`) because Fibery's workflow API is fiddly. Upgrade to true
  workflow fields in the UI when you need colored pill UX.

## API reference for the script

The script uses three Fibery commands via `POST /api/commands`:

- `fibery.schema/query` — read current schema (used for idempotency checks)
- `fibery.schema/batch` — wraps inner `schema.type/create`, `schema.field/create`, `schema.type/delete`, `fibery.app/install-mixins` commands
- `fibery.entity/query` + `fibery.entity/create` — seed entities

Command names and argument shapes were reverse-engineered from the
[`fibery-unofficial` npm package](https://www.npmjs.com/package/fibery-unofficial)
(MIT-licensed).
