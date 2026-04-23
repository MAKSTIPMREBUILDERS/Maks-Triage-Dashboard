# MAKS Live Support Triage Dashboard

A live, shared team dashboard for the MAKS TIPM Rebuilders support team. Pulls customer-waiting tickets from HubSpot every 5 minutes, lets the team triage together with shared state, and can assign owners and send replies directly to HubSpot.

## Features

- **Live HubSpot data** — auto-refreshed every 5 minutes via scheduled function
- **Shared team state** — when Arjay marks something handled, Kent sees it too
- **Assign HubSpot owners** — pick any CSR from a dropdown, saved straight to HubSpot
- **Send replies** — send emails or save draft notes, all logged as engagements on the ticket
- **Priority classification** — On fire / Hot / Core / Warm, auto-classified from ticket content
- **Suggested draft responses** — pre-written replies the team can edit and send
- **Netlify Identity auth** — only invited team members can access
- **Search & filter** across all ticket fields

## Architecture

```
Browser (logged-in team member)
  ↓ fetch with JWT
Netlify Edge
  ↓ routes to
Netlify Functions (serverless)
  ├── get-tickets    → reads cached data + shared handled state
  ├── handled        → updates shared handled state
  ├── assign-owner   → updates ticket owner in HubSpot
  ├── send-reply     → logs email engagement in HubSpot
  └── refresh-tickets (scheduled, runs every 5 min)
                     → fetches from HubSpot API
                     → classifies priority + generates drafts
                     → writes to Netlify Blobs cache
                     ↓
                  Netlify Blobs (shared key-value store)
```

## One-time setup

### Step 1 — Get a HubSpot Private App token (2 min)

1. In HubSpot, click your profile picture (top right) → **Settings**
2. In the left sidebar: **Integrations** → **Private Apps**
3. Click **Create a private app**
4. **Basic Info** tab: name it `MAKS Triage Dashboard`
5. **Scopes** tab, grant these:
   - `tickets` — Read, Write
   - `crm.objects.contacts.read`
   - `crm.objects.owners.read`
   - `sales-email-read`
6. Click **Create app** → **Continue creating**
7. On the app page, click **Show token** and copy it (starts with `pat-`)
8. **Save this token somewhere safe — you'll paste it into Netlify next**

### Step 2 — Deploy to Netlify

**Via GitHub (recommended):**

1. Create a new GitHub repo, push this folder
2. In Netlify: **Add new site** → **Import from Git** → select your repo
3. Build settings are pre-configured via `netlify.toml`, just click **Deploy**

**Via Netlify CLI:**

```bash
cd triage-v2
npm install
netlify login
netlify init    # create a new site
netlify deploy --prod
```

**Via drag-and-drop:** Doesn't work for this version — the scheduled functions need Git or CLI.

### Step 3 — Add the HubSpot token to Netlify

1. In your Netlify site dashboard: **Site configuration** → **Environment variables**
2. Click **Add a variable**
3. Key: `HUBSPOT_TOKEN`, value: the `pat-xxx` token from Step 1
4. Click **Create variable**
5. Trigger a redeploy: **Deploys** → **Trigger deploy** → **Deploy site**

### Step 4 — Enable Netlify Identity

1. In your Netlify site: **Site configuration** → **Identity** → **Enable Identity**
2. Under **Registration**, set to **Invite only** (critical — keeps public from signing up)
3. Under **Git Gateway**: leave disabled (not needed)
4. Click **Invite users** and add:
   - mak@tipmrebuilders.com
   - arjay@... (and whichever CSRs should have access)
5. Each person gets an email to set their password

### Step 5 — Kick off the first data fetch

The scheduled function runs every 5 minutes, but won't have fired yet on a fresh deploy. Trigger it once manually:

- Visit `https://your-site.netlify.app/api/refresh` in a browser (you'll need to be signed in)
- Or: just open the dashboard and click **Refresh now**

That's it. Share the URL with the team.

## Daily use

- **Arjay** opens the dashboard every morning, reviews the On fire and Hot tickets, assigns owners, drops quick replies to the easy ones
- **CSRs** filter to tickets assigned to them, reply from the dashboard, mark handled
- Everyone sees the same state in real-time (polls every 60 seconds)
- Shared handled state means no duplicate work

## Cost

All free on Netlify's free tier:
- 125,000 function invocations/month (plenty — 5-min refreshes = ~9,000/month)
- Netlify Blobs storage is free for reasonable volumes
- Netlify Identity: free for up to 1,000 active users
- HubSpot API: well within rate limits for this usage pattern

## Updating classification rules or drafts

The priority classification logic and draft templates live in `netlify/functions/refresh-tickets.mjs`:
- `classifyPriority()` — rules for fire/hot/core/warm
- `generateDraft()` — template replies by priority
- `suggestAssignee()` — routing hints

Edit, push, and they take effect on the next scheduled refresh (within 5 minutes).

## Files

```
triage-v2/
├── public/
│   └── index.html          — the dashboard UI
├── netlify/
│   └── functions/
│       ├── refresh-tickets.mjs  — scheduled HubSpot fetcher + classifier
│       ├── get-tickets.mjs      — serves cached data to UI
│       ├── handled.mjs          — shared handled state
│       ├── assign-owner.mjs     — owner assignment + list
│       └── send-reply.mjs       — email engagement + note logging
├── netlify.toml            — build config, schedule, redirects
├── package.json            — dependencies
└── README.md               — this file
```

## Troubleshooting

**"No ticket data yet"** — the scheduled function hasn't fired. Click Refresh now or visit `/api/refresh`.

**"Unauthorized" errors** — make sure the user is signed in via Netlify Identity. Open the widget and check the user dropdown.

**"HUBSPOT_TOKEN not configured"** — env var isn't set. Step 3 above, then redeploy.

**Priority classification looks wrong** — the rules in `classifyPriority()` are heuristics based on keyword matching. Review the ticket content in the dashboard; if you see a pattern that's misclassified, tell Claude and we'll add a rule.

**Email not sending** — the `send-reply` function logs an outbound email engagement in HubSpot. It does NOT send via SMTP. HubSpot's connected inbox handles the actual delivery. Check the ticket's contact has a valid email.

## Security notes

- HubSpot token is server-side only, never exposed to browsers
- All API routes require a valid Netlify Identity JWT
- The HubSpot URL pattern `app.hubspot.com/contacts/21300550/...` is hardcoded — this is your account ID and isn't secret, but is specific to your HubSpot
- Shared state is namespaced per-site in Netlify Blobs

## What's not in v1 (ideas for later)

- Per-user analytics (who replied to what, response time trends)
- Slack notifications when a fire-level ticket appears
- Auto-assign rules based on ticket type
- Bulk actions (assign 10 tickets at once)
- Better draft generation using an LLM instead of templates
