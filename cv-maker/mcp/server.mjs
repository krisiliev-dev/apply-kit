#!/usr/bin/env node
// CV-maker MCP server.
//
// A thin stdio MCP server that lets an external agent (Claude Code) operate the
// same CVs the web app edits. It holds no state of its own — every tool is an
// HTTP call to the running web app's API routes, which read/write the shared
// file store (CV_MAKER_DATA_DIR). So the loop closes: the agent writes a CV →
// the app's editor picks it up on its next sync.
//
// Requires the web app to be running. Configure the base URL with CV_MAKER_URL
// (default http://localhost:3000).
//
// Logs go to stderr only — stdout is reserved for the MCP protocol.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.CV_MAKER_URL || "http://localhost:3000").replace(/\/+$/, "");

function log(...args) {
  console.error("[cv-mcp]", ...args);
}

// Fetch a JSON API route. Returns parsed JSON; throws a readable Error on a
// network failure or non-2xx response.
async function api(path, init) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new Error(
      `Could not reach the web app at ${BASE}${path}. Is it running? ` +
        `(start it with \`npm run dev\` in ~/code/cv-maker). Underlying: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response (${res.status}) from ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status} from ${path}`);
  }
  return data;
}

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (err) => ({
  content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});
const pretty = (v) => JSON.stringify(v, null, 2);

const server = new McpServer({ name: "cv-maker", version: "0.1.0" });

server.registerTool(
  "list_cvs",
  {
    title: "List CVs",
    description:
      "List every CV document in the store plus the variant registry (slug, target role, last update). Start here to see what exists.",
    inputSchema: {},
  },
  async () => {
    try {
      const { docs, variants } = await api("/api/docs");
      return ok(pretty({ docs, variants }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "read_cv",
  {
    title: "Read a CV",
    description:
      "Fetch one CV document by slug as full JSON (pages → nodes). Edit the returned JSON and pass it back via write_cv to rework the CV.",
    inputSchema: {
      slug: z.string().describe("The CV slug, e.g. 'me' or 'acme-security-engineer'."),
    },
  },
  async ({ slug }) => {
    try {
      const { doc } = await api(`/api/docs/${encodeURIComponent(slug)}`);
      return ok(pretty(doc));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "write_cv",
  {
    title: "Write a CV",
    description:
      "Create or overwrite a CV document. `doc` is a full CvDocument object; doc.slug must equal `slug`. The editor picks up the change on its next sync.",
    inputSchema: {
      slug: z.string().describe("The CV slug. Must match doc.slug."),
      doc: z
        .any()
        .describe("Full CvDocument object: { slug, targetRole, pages:[{id,width,height,nodes:[...]}], theme, updatedAt }."),
    },
  },
  async ({ slug, doc }) => {
    try {
      // Stamp updatedAt so the browser's poll notices the change.
      const next = { ...doc, slug, updatedAt: Date.now() };
      const res = await api(`/api/docs/${encodeURIComponent(slug)}`, {
        method: "PUT",
        body: JSON.stringify({ doc: next }),
      });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "read_base",
  {
    title: "Read base CV",
    description:
      "Read the base identity (profile + structured CVContent) the AI tailors FROM. Returns null if the user hasn't set one yet.",
    inputSchema: {},
  },
  async () => {
    try {
      const { base } = await api("/api/base");
      return ok(pretty(base));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "write_base",
  {
    title: "Write base CV",
    description:
      "Set the user's base identity. `profile` needs at least name + email; `cv` is CVContent with experiences[] and education[]. This is what tailor_cv works from and what the editor seeds new docs from.",
    inputSchema: {
      profile: z.any().describe("Profile object: { name, title, email, location?, phone?, links?, summary? }."),
      cv: z
        .any()
        .describe("CVContent: { slug, targetRole, profile, experiences[], education[], projects?, skills?, interests? }."),
    },
  },
  async ({ profile, cv }) => {
    try {
      const res = await api("/api/base", {
        method: "PUT",
        body: JSON.stringify({ profile, cv }),
      });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "tailor_cv",
  {
    title: "Tailor a CV to a job",
    description:
      "Rework the base CV for a specific posting: parses the job, drafts a tailored variant (truthful — no invented experience), seeds a new document, and saves it. Returns the new slug. Requires a base CV (see write_base) and a running app with an AI key.",
    inputSchema: {
      jobText: z.string().optional().describe("The full job posting text. Provide this or jobUrl."),
      jobUrl: z.string().optional().describe("URL of the posting (the app fetches + parses it). Provide this or jobText."),
      company: z.string().optional().describe("Override the company name used for the slug."),
      role: z.string().optional().describe("Override the role used for the slug."),
    },
  },
  async ({ jobText, jobUrl, company, role }) => {
    try {
      const res = await api("/api/docs/tailor", {
        method: "POST",
        body: JSON.stringify({ jobText, jobUrl, company, role }),
      });
      // Drop the heavy doc from the summary; the agent can read_cv if needed.
      const { doc, ...summary } = res;
      void doc;
      return ok(pretty(summary));
    } catch (err) {
      return fail(err);
    }
  },
);

// ————————————————————————————————————————————————
// Discovery tools — drive job discovery from the agent side.
// ————————————————————————————————————————————————

server.registerTool(
  "get_discovery_prefs",
  {
    title: "Get discovery preferences",
    description:
      "Read the job-discovery preferences (watchlist, RSS feeds, HN toggle, work auth, preferred locations, remote-only, salary floor, title denylist).",
    inputSchema: {},
  },
  async () => {
    try {
      const { prefs } = await api("/api/discover/prefs");
      return ok(pretty(prefs));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "set_discovery_prefs",
  {
    title: "Set discovery preferences",
    description:
      "Patch the discovery preferences (partial merge). Useful keys: workAuth (e.g. ['UK','EU']), preferredLocations (['Sofia','Manchester']), remoteOnly, salaryFloor, titleDenylist, trackHnHiring.",
    inputSchema: {
      prefs: z
        .any()
        .describe("Partial DiscoveryPreferences object to merge into the current prefs."),
    },
  },
  async ({ prefs }) => {
    try {
      const res = await api("/api/discover/prefs", {
        method: "PUT",
        body: JSON.stringify(prefs ?? {}),
      });
      return ok(pretty(res.prefs));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_sources",
  {
    title: "List discovery sources",
    description:
      "List the registered job sources (ATS boards, RSS feeds, career pages) with their kind, ref, region, and last-crawled time.",
    inputSchema: {},
  },
  async () => {
    try {
      const { sources } = await api("/api/discover/sources");
      return ok(pretty(sources));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "add_source",
  {
    title: "Add a discovery source",
    description:
      "Register (or update) a job source. kind: 'greenhouse'|'lever'|'ashby' (ref = board slug), 'rss' (ref = feed URL), or 'careerpage'|'board' (ref = page URL, crawled separately). Re-adding the same kind+ref updates it.",
    inputSchema: {
      kind: z.enum([
        "greenhouse",
        "lever",
        "ashby",
        "rss",
        "careerpage",
        "board",
        "smartrecruiters",
        "workday",
        "jooble",
        "arbeitnow",
        "reed",
        "remotive",
        "jobicy",
        "themuse",
        "findwork",
        "eures",
      ]),
      ref: z
        .string()
        .describe(
          "greenhouse/lever/ashby: board slug. rss/careerpage/board: full URL. smartrecruiters: companyId or companyId:country (e.g. BoschGroup:bg). workday: careers URL. jooble: 'keywords' or 'keywords|location' (needs JOOBLE_API_KEY). arbeitnow: keyword or '*'. reed/remotive/jobicy/themuse/findwork: 'keywords' or 'keywords|location' (e.g. 'cyber security|Manchester'; reed needs REED_API_KEY, findwork needs FINDWORK_API_KEY). eures: EU/EEA public portal — 'keywords' or 'keywords|<2-letter country>' (e.g. 'security engineer|bg'; no UK, no key).",
        ),
      label: z.string().optional().describe("Human-readable name."),
      region: z.string().optional().describe("Location hint, e.g. 'Sofia' / 'Remote-EU'."),
      note: z.string().optional(),
      enabled: z.boolean().optional().describe("Default true."),
    },
  },
  async ({ kind, ref, label, region, note, enabled }) => {
    try {
      const res = await api("/api/discover/sources", {
        method: "POST",
        body: JSON.stringify({ kind, ref, label, region, note, enabled, addedBy: "research" }),
      });
      return ok(pretty(res.source));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "remove_source",
  {
    title: "Remove a discovery source",
    description: "Delete a registered source by its id (id is `kind:ref` lowercased; see list_sources).",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      const res = await api(`/api/discover/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_postings",
  {
    title: "List discovered postings",
    description:
      "List the postings currently in the shared pool (title, company, location, url). Read these to pick a role to tailor_cv against.",
    inputSchema: {},
  },
  async () => {
    try {
      const { postings } = await api("/api/discover/postings");
      const slim = (postings ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        company: p.company,
        location: p.location,
        salary: p.salary,
        url: p.url,
        source: p.source?.kind,
      }));
      return ok(pretty({ count: slim.length, postings: slim }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "ingest_postings",
  {
    title: "Ingest postings",
    description:
      "Add postings you found via research into the shared pool (merged by id). Each posting: { id, source:{kind,...}, url, title, company, location?, salary?, description?, postedAt?, fetchedAt }.",
    inputSchema: {
      postings: z.any().describe("Array of JobPosting objects."),
    },
  },
  async ({ postings }) => {
    try {
      const res = await api("/api/discover/postings", {
        method: "POST",
        body: JSON.stringify({ postings: postings ?? [] }),
      });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "run_discovery",
  {
    title: "Run discovery",
    description:
      "Crawl all enabled ATS/RSS sources + HN (per prefs), merge fresh postings into the pool, and return counts. Then use list_postings to see results.",
    inputSchema: {},
  },
  async () => {
    try {
      const res = await api("/api/discover/run", { method: "POST" });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "sync_email",
  {
    title: "Sync job-alert emails",
    description:
      "Pull recent LinkedIn/jobs.bg saved-search alert emails from the user's Gmail (IMAP) and merge parsed postings into the pool. Requires GMAIL_USER/GMAIL_APP_PASSWORD in the app's .env.local plus saved-search alerts (optionally filtered to a label set via GMAIL_MAILBOX). See docs/email-alerts.md.",
    inputSchema: {
      mailbox: z.string().optional().describe("Gmail mailbox/label to read (default INBOX or GMAIL_MAILBOX)."),
      days: z.number().optional().describe("How many days back to read (default 14)."),
    },
  },
  async ({ mailbox, days }) => {
    try {
      const res = await api("/api/discover/email-sync", {
        method: "POST",
        body: JSON.stringify({ mailbox, days }),
      });
      return ok(pretty(res));
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready — proxying to ${BASE}`);
