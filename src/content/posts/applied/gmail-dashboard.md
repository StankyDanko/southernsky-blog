---
title: "Automating Your Email Chaos: Building a Gmail Dashboard"
description: "I had 47,000 unread emails. So I built a dashboard that cleans, labels, and summarizes them automatically — with undo for everything."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 15
prerequisites: ["javascript-basics"]
category: web-development
tags: ["gmail", "api", "oauth", "nextjs", "automation"]
heroImage: "/images/posts/gmail-dashboard.webp"
featured: false
draft: false
---

I had 47,000 unread emails. That's not a flex — that's a problem.

Years of newsletter subscriptions, automated notifications, promotional blasts, and the occasional actual human being trying to reach me had accumulated into a wall of noise so thick that "Inbox Zero" felt like a punchline. I tried filters. I tried "mark all as read." I tried declaring email bankruptcy and just ignoring it. None of it worked because none of it was systematic.

So I built a dashboard. A full Next.js application that connects directly to the Gmail API, scans my inbox, and gives me surgical tools to clean, label, archive, and summarize thousands of emails at once — with dry-run previews for everything and an undo queue so I never lose something I didn't mean to touch.

This post walks through the entire build: OAuth setup, the API route architecture, bulk operations that respect Google's rate limits, and the safety mechanisms that make it all trustworthy enough to point at 47,000 emails and pull the trigger.

---

## The Architecture at a Glance

Before we dig into code, here's the shape of the system:

```
┌──────────────────────────────────┐
│        Next.js Frontend          │
│   (React 19 + Tailwind CSS v4)   │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────────┐ │
│  │Cleanup│ │Power │ │Analytics │ │
│  │ Tab   │ │Tools │ │  Tab     │ │
│  └──┬───┘ └──┬───┘ └────┬─────┘ │
│     │        │           │       │
└─────┼────────┼───────────┼───────┘
      │ fetch  │ fetch     │ fetch
      ▼        ▼           ▼
┌──────────────────────────────────┐
│       Next.js API Routes         │
│  /api/nuke    /api/vault         │
│  /api/promo-purge                │
│  /api/cold-storage               │
│  /api/blackhole                  │
│  /api/summarize                  │
│  /api/vip-sentinel               │
│  /api/undo                       │
│  /api/heavyweight                │
└──────────────┬───────────────────┘
               │ googleapis SDK
               ▼
┌──────────────────────────────────┐
│         Gmail API (v1)           │
│   OAuth2 + 250 QU/sec limit      │
└──────────────────────────────────┘
```

The frontend is a tabbed dashboard — Cleanup, Power Tools, Analytics, Logs, Settings. Each tool hits a corresponding API route. Each API route talks to Gmail through a shared `lib/gmail.ts` module that handles authentication, pagination, and batch operations. Winston logs every action to both the console and a log file, and the Logs tab renders them in a live terminal view.

No database. No external services (beyond Gmail itself and an optional AI API for summaries). Your OAuth credentials live on your machine and never leave.

---

## Step 1: Gmail API Setup and OAuth

This is the part most tutorials gloss over, and it's the part that will cost you 45 minutes of confusion if you don't get it right up front.

### Creating the Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project
2. Navigate to **APIs & Services > Library** and enable the **Gmail API**
3. Go to **APIs & Services > OAuth consent screen** and configure it as an **External** application (you can keep it in testing mode — you only need your own account)
4. Add the scope `https://mail.google.com/` — this is the full-access scope, which you need for operations like `batchModify` and filter creation
5. Add your own email as a test user

### Creating OAuth Credentials

Go to **APIs & Services > Credentials**, create an **OAuth 2.0 Client ID** of type "Desktop app," and download the JSON file. Save it as `credentials.json` in your project root.

That file looks something like this:

```json
{
  "installed": {
    "client_id": "123456789-abcdefg.apps.googleusercontent.com",
    "client_secret": "GOCSPX-your-secret-here",
    "redirect_uris": ["http://localhost"]
  }
}
```

**Important:** Those are placeholder values. Never commit your real `credentials.json` to version control. Add it to `.gitignore` immediately.

### The Auth Module

The core auth lives in a single file:

```typescript
// lib/gmail.ts
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import fs from "fs-extra";
import path from "path";

const SCOPES = ["https://mail.google.com/"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

let oauth2Client: OAuth2Client | null = null;

export async function getGmailService() {
  if (!oauth2Client) {
    const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } =
      credentials.installed || credentials.web;

    oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
  }

  if (fs.existsSync(TOKEN_PATH)) {
    const token = await fs.readJson(TOKEN_PATH);
    oauth2Client.setCredentials(token);

    // Auto-refresh expired tokens
    if (oauth2Client.isTokenExpiring()) {
      const newToken = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newToken.credentials);
      await fs.writeJson(TOKEN_PATH, newToken.credentials);
    }
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}
```

A few things to notice:

- **Module-level singleton.** The `oauth2Client` is cached — we only read `credentials.json` once per server lifetime. Every API route that calls `getGmailService()` gets the same authenticated client.
- **Automatic token refresh.** The `isTokenExpiring()` check handles the case where your access token has expired but your refresh token is still valid. The new token gets written back to `token.json` so you don't re-auth on the next request.
- **`credentials.installed || credentials.web`** — Google's downloaded JSON uses `"installed"` for desktop apps and `"web"` for web apps. Supporting both means you don't have to care which one you picked.

The first time you run the app, you'll need to complete the OAuth flow once to generate `token.json`. After that, the refresh token keeps you authenticated indefinitely.

---

## Step 2: Paginated Message Fetching

Gmail's API doesn't return all your messages at once. It paginates, returning up to 500 message IDs per request along with a `nextPageToken`. If you have 47,000 emails matching a query, you need to loop.

```typescript
export async function listMessageIds(
  query: string,
  maxResultsLimit = 10000
) {
  const service = await getGmailService();
  let allIds: string[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const res = await service.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(maxResultsLimit - allIds.length, 500),
      pageToken,
    });
    if (res.data.messages) {
      allIds = allIds.concat(
        res.data.messages.map((msg: any) => msg.id)
      );
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken && allIds.length < maxResultsLimit);

  return allIds;
}
```

The `maxResultsLimit` parameter is a safety valve. For most operations, 10,000 is a reasonable ceiling. You don't want to accidentally fetch 200,000 message IDs into memory — not because your machine can't handle it, but because you probably don't want to trash 200,000 emails at once anyway.

The `q` parameter accepts full Gmail search syntax: `is:unread older_than:6m`, `has:attachment larger:5m`, `category:promotions`, `from:user@example.com`. Anything you can type into Gmail's search bar works here.

---

## Step 3: The Scan-Confirm-Execute Pattern

Every destructive operation in the dashboard follows the same three-phase pattern:

1. **Scan** — Query Gmail, count matching messages, pull a sample preview
2. **Confirm** — Show the user what will happen before it happens
3. **Execute** — Process in chunks with progress tracking and undo registration

This pattern is enforced at the API level. Take the Bulk Nuker route:

```typescript
// app/api/nuke/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const { action } = body;

  // Phase 1: Scan
  if (action === "scan") {
    const { query } = body;
    const ids = await listMessageIds(query, 10000);

    // Fetch metadata for a sample preview
    const sampleIds = ids.slice(0, 3);
    const sampleData = await Promise.all(
      sampleIds.map((id) => getMessageMetadata(id))
    );

    return NextResponse.json({
      success: true,
      count: ids.length,
      ids,
      sample: sampleData,
    });
  }

  // Phase 2: Execute (only after user confirms)
  if (action === "trash") {
    const { ids } = body;
    const chunk = ids.slice(0, 1000);
    await batchModify(chunk, ["TRASH"], []);
    return NextResponse.json({
      success: true,
      processed: chunk.length,
    });
  }
}
```

The scan phase returns real email subjects and senders so you can verify: "Yes, these are the newsletters I want gone." The execute phase only runs after the user has seen the preview and clicked confirm.

The `getMessageMetadata` helper fetches just the subject and sender — not the full message body — using Gmail's `format: "metadata"` option. This is critical for speed. Fetching full message content for 10,000 emails would take minutes. Fetching metadata takes seconds.

```typescript
export async function getMessageMetadata(id: string) {
  const service = await getGmailService();
  const res = await service.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["Subject", "From"],
  });
  const headers = res.data.payload?.headers || [];
  const subject =
    headers.find((h: any) => h.name === "Subject")?.value ||
    "No Subject";
  let from =
    headers.find((h: any) => h.name === "From")?.value ||
    "Unknown Sender";
  // Strip the email address, keep just the display name
  from = from.replace(/<.*>/, "").replace(/"/g, "").trim();
  return { id, subject, from };
}
```

---

## Step 4: Dry-Run Mode

Dry-run mode is the single most important feature in the entire application, and it's embarrassingly simple to implement.

On the frontend, the Cleanup tab has a toggle:

```typescript
const [nukeDryRun, setNukeDryRun] = useState(true);
```

When `nukeDryRun` is `true`, the confirmation modal changes its button text:

```typescript
confirmText: nukeDryRun
  ? "Close Dry Run"
  : "Execute Nuke Now"
```

And the confirm handler just closes the modal without executing:

```typescript
const confirmAction = async () => {
  if (nukeDryRun) {
    setModalState((m) => ({ ...m, isOpen: false }));
    return; // Nothing happens. That's the point.
  }
  // ... actual execution
};
```

The dry run still calls the scan endpoint. You still see the real count, the real sample emails, the real query. You see everything that *would* happen. You just don't pull the trigger.

Dry-run is enabled by default. You have to consciously turn it off. This is a deliberate design choice. When you're pointing a tool at 47,000 emails, the default behavior should be "show me what you're going to do" — not "do it and hope for the best."

---

## Step 5: Rate Limiting and Chunked Execution

Google imposes a hard limit of **250 quota units per second** on the Gmail API. Different operations cost different amounts:

| Operation | Quota Cost |
|-----------|-----------|
| `messages.list` | 5 units |
| `messages.get` (metadata) | 5 units |
| `messages.get` (full) | 10 units |
| `messages.batchModify` | 50 units |
| `users.settings.filters.create` | 5 units |

The `batchModify` endpoint accepts up to 1,000 message IDs per call. So if you're trashing 8,000 emails, you need 8 API calls. At 50 quota units per call with a 250 QU/sec limit, you can safely fire about 5 calls per second.

But here's the thing — we don't do that from a single serverless function. Next.js API routes on platforms like Vercel have a 15-second timeout. Eight sequential API calls with network latency could blow past that.

The solution is **client-driven chunking**. The frontend drives the loop:

```typescript
const executeChunkedAction = async (
  endpoint: string,
  action: string,
  ids: string[],
  label: string,
  undoTitle: string,
  undoAction: UndoAction
) => {
  const chunkSize = 1000;
  let processed = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: chunk }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    processed += chunk.length;
    setModalState((m) => ({
      ...m,
      progress: Math.round((processed / ids.length) * 100),
    }));

    // 500ms delay between chunks to respect rate limits
    if (i + chunkSize < ids.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
};
```

Each iteration sends one chunk of up to 1,000 IDs to the API route. The API route processes that chunk and returns. The client waits 500ms, then sends the next chunk. The progress bar updates in real time.

This approach has several advantages:

- **No serverless timeout issues.** Each API call is fast and independent.
- **Visible progress.** The user sees a percentage bar creeping toward 100%.
- **Graceful interruption.** If something fails on chunk 5 of 8, you've still successfully processed chunks 1-4.
- **Rate-limit safety.** The 500ms delay between chunks guarantees you never exceed Google's quota.

---

## Step 6: The Undo Queue

Every destructive operation registers itself in an undo stack:

```typescript
const [undoStack, setUndoStack] = useState<
  {
    id: number;
    title: string;
    ids: string[];
    undoAction: UndoAction;
  }[]
>([]);
```

When a trash operation completes:

```typescript
setUndoStack((prev) => [
  {
    id: Date.now(),
    title: undoTitle + " (" + processed + " emails)",
    ids: ids.slice(0, processed),
    undoAction,
  },
  ...prev,
]);
```

This is the key insight: **we never permanently delete anything**. The "Bulk Nuke" moves emails to Trash. The "Cold Storage Archiver" removes the INBOX label (archiving to All Mail). Neither operation is irreversible.

Undoing a trash operation means removing the TRASH label:

```typescript
// app/api/undo/route.ts
if (action === "restore") {
  await batchModify(chunk, [], ["TRASH"]);
}
```

Undoing an archive means re-adding the INBOX label:

```typescript
if (action === "unarchive") {
  await batchModify(chunk, ["INBOX"], []);
}
```

No database. No SQLite. No state management beyond React's `useState`. Gmail itself is the state store. We just add and remove labels. This is possible because Gmail's label system is how the entire email lifecycle works internally — "deleting" an email in Gmail has always just meant adding the TRASH label.

The undo stack lives in the browser's memory for the current session. If you close the tab, the stack is gone — but the emails are still in Trash for 30 days, and you can always recover them from Gmail's web interface.

---

## Step 7: The Cleanup Tools

The dashboard ships with four cleanup tools in the free tier, each targeting a different kind of inbox clutter.

### Bulk Nuker

The Swiss army knife. Enter any Gmail search query — `from:notifications@example.com`, `subject:Your weekly digest`, `older_than:1y is:unread` — and the Nuker scans, previews, and trashes everything matching. Dry-run mode enabled by default.

### Promo-Purge

Targets Gmail's category tabs. Scans `category:promotions` and/or `category:social`, shows you the count and a sample, then trashes them in chunks. Gmail's built-in category detection does the classification — we just expose a button to nuke the results.

```typescript
const parts: string[] = [];
if (includePromo) parts.push("category:promotions");
if (includeSocial) parts.push("category:social");
const query = parts.join(" OR ");
```

### Heavyweight Sweeper

Finds emails with large attachments. The scan query uses Gmail's `larger:` operator:

```
has:attachment larger:5m
```

The results include file size estimates so you can see which emails are hogging your storage. The sweeper reports actual sizes per email, sorted largest-first, so the 45MB PDF from 2019 is right at the top where it belongs.

### Cold Storage Archiver

Archives old unread emails — emails you received months ago and never opened. The default threshold is 6 months:

```
is:unread older_than:6m in:inbox
```

This doesn't delete anything. It removes the INBOX label, sending emails to All Mail. They're still searchable, still there — just not staring at you every time you open Gmail. And because undo adds the INBOX label back, the operation is completely reversible.

---

## Step 8: Power Tools

Beyond basic cleanup, the dashboard includes specialized tools that go deeper.

### Attachment Vault

This is the feature I'm most proud of. Most email cleanup tools let you delete emails with large attachments. Gmail PowerUser lets you **extract the attachments first**, then strip them from the email body.

The vault scanner walks the MIME tree of each message, identifying every attached file:

```typescript
function walkParts(parts: any[]) {
  if (!parts) return;
  for (const part of parts) {
    if (part.parts) walkParts(part.parts);
    if (
      part.body?.attachmentId &&
      part.filename &&
      part.filename.length > 0
    ) {
      attachments.push({
        messageId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
  }
}
```

Downloads go to a local `vault/` directory with timestamps to prevent filename collisions. The attachment data comes back as URL-safe base64 from Google's API, so we decode it before writing:

```typescript
const data = res.data.data as string;
const buffer = Buffer.from(
  data.replace(/-/g, "+").replace(/_/g, "/"),
  "base64"
);
```

Now you can delete the 45MB email and keep the PDF.

### VIP Sentinel

Scans your sent mail to find people you actually reply to — your real human contacts, not mailing lists. It analyzes your last 500 sent messages, extracts recipient addresses, and ranks them by frequency:

```typescript
const contacts = Array.from(contactsMap.entries())
  .map(([email, count]) => ({ email, count }))
  .filter((c) => c.count >= 2)
  .sort((a, b) => b.count - a.count)
  .slice(0, 20);
```

Anyone you've replied to at least twice gets surfaced as a VIP candidate. One click to star all their emails in your inbox.

This is a different approach than most "important contacts" features. Gmail's own priority inbox uses engagement signals (opens, clicks). VIP Sentinel uses reply frequency, which is a much stronger signal of actual human relationships. You don't reply to newsletters.

### BlackHole

One-click permanent routing. Enter a sender address or domain, and BlackHole creates a Gmail filter that sends all future mail from that source directly to Trash:

```typescript
await service.users.settings.filters.create({
  userId: "me",
  requestBody: {
    criteria: { from: target },
    action: {
      addLabelIds: ["TRASH"],
      removeLabelIds: ["INBOX"],
    },
  },
});
```

This uses Gmail's native filters, not application-level rules. The filter persists even if you uninstall the dashboard. It works on mobile, on the web — everywhere Gmail runs.

### Thread Summarizer

For those 80-message email threads where someone asks "can you catch me up?", the summarizer pulls the full thread content and sends it to Gemini for a structured summary:

```typescript
const prompt = `You are an expert email analyst.
Summarize this email thread concisely.

Rules:
- Start with a 1-sentence TL;DR
- List key decisions or outcomes as bullet points
- List any open action items
- Keep total response under 300 words

THREAD (${messages.length} messages):

${cappedTranscript}`;
```

The transcript is capped at 30,000 characters to stay within model context limits. Each message preserves the sender and date so the summary reflects who said what and when.

This requires a Gemini API key in your `.env.local`. If you don't have one, everything else still works — the summarizer is the only feature that touches an external AI service.

---

## Step 9: Observability

Every operation logs structured entries through Winston:

```typescript
import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: "logs/gmail-poweruser.log",
    }),
    new winston.transports.Console(),
  ],
});
```

Logs go to both a file and the console. The dashboard's Logs tab renders these in a terminal-style view with color coding — green for success, red for errors, white for info. The log entries from operations look like:

```
[Nuke] Starting query scan: 'from:noreply@example.com older_than:1y'
[Nuke] Scan complete. Found 1,247 emails.
[Nuke] Safely trashed chunk of 1,000 emails.
[Nuke] Safely trashed chunk of 247 emails.
```

When something goes wrong — a quota exceeded error, an invalid query, a network timeout — the error shows up in the same log stream. No silent failures.

---

## The Safety Philosophy

Let me be blunt about the design philosophy, because it's the most important part of this project.

**Never delete without confirmation.** Every destructive operation shows you what it will affect before it runs. Not "this will affect approximately some emails." The exact count. A sample of real subjects and senders.

**Dry-run is the default.** The first time you use any cleanup tool, it runs in dry-run mode. You have to actively choose to turn it off.

**Everything is reversible.** Trash operations use Gmail's TRASH label, which gives you 30 days to recover. Archive operations remove INBOX but keep the email in All Mail. The undo queue lets you reverse any operation with one click.

**The tool is local-first.** Your credentials and tokens never leave your machine. There's no SaaS backend scanning your inbox in perpetuity. You run it when you want to, and it stops when you stop it.

This matters because email cleanup tools have a trust problem. You're giving a tool access to your entire email history — every password reset, every bank statement, every private conversation. The minimum acceptable architecture is one where the user can see exactly what the tool is doing, reverse anything it did, and shut it off completely by closing a browser tab.

---

## What I Learned

Building Gmail PowerUser clarified a few things about working with Google's APIs that I haven't seen documented well elsewhere:

**Gmail's label system is the API.** Everything — inbox, trash, archive, spam — is just a label. "Deleting" means adding TRASH. "Archiving" means removing INBOX. Once you internalize this, the API clicks. Every operation is just `batchModify` with different label lists.

**`batchModify` is your best friend.** It accepts up to 1,000 IDs and applies label changes to all of them in a single API call. Without it, trashing 10,000 emails would require 10,000 individual `modify` calls — a quota nightmare.

**Client-driven chunking beats server-side batching.** Trying to process 10,000 emails in a single API route will timeout on any serverless platform. Let the client drive the loop, handle the progress UI, and manage the delay between chunks. It's more code, but it's reliable code.

**Metadata-only fetches are 10x faster.** The difference between `format: "full"` and `format: "metadata"` on `messages.get` is dramatic. For scan/preview operations, you almost never need the full message body.

---

## Running It Yourself

```bash
git clone https://github.com/your-username/gmail-poweruser.git
cd gmail-poweruser
npm install
```

Drop your `credentials.json` from Google Cloud Console into the project root. Run the dev server:

```bash
npm run dev
```

Complete the OAuth flow once (it'll open a browser window), and you're in. The dashboard loads at `http://localhost:3000/dashboard`.

Start with dry-run mode on. Scan your inbox. See what's in there. When you trust the tool, turn dry-run off and start cleaning.

The tech stack is Next.js 16 with React 19, Tailwind CSS v4, Recharts for the analytics charts, and Winston for logging. No database required. The only external dependency beyond Gmail is an optional Gemini API key for the thread summarizer.

---

## Where This Goes Next

The current build handles cleanup and organization. The roadmap includes:

- **Auto-Filter Engine** — a visual rule builder that pushes complex filters to Gmail without touching the settings UI
- **Storage analytics** — breakdown by attachment type, top senders by volume, inbox health scoring over time
- **Scheduled cleanup** — run promo-purge and cold storage on a cron, with email reports

But honestly, the core four cleanup tools plus the undo queue already solved my 47,000 email problem. The rest is polish.

If your inbox looks like mine did — a graveyard of newsletters, promotions, and automated notifications burying the emails that actually matter — the right tool isn't a subscription service that scans your inbox forever. It's a local dashboard you run once, clean up, and close. Your email, your machine, your rules.
