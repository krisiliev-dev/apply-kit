import { emailConfigured, fetchRecentAlerts } from "@/lib/discovery/email/imap";
import { parseAlertEmail } from "@/lib/discovery/email/parse";
import { payloadToPosting } from "@/lib/discovery/ingestBuffer";
import { ingestPostings } from "@/lib/doc/serverStore";
import type { IngestPayload } from "@/lib/discovery/types";

// POST /api/discover/email-sync
// Body: { mailbox?: string, days?: number }
//
// Reads recent job-alert emails from the user's Gmail and merges the parsed
// postings into the shared pool. Backs the MCP `sync_email` tool.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!emailConfigured()) {
    return Response.json(
      {
        error:
          "Gmail not configured. Add GMAIL_USER + GMAIL_APP_PASSWORD to .env.local (see docs/email-alerts.md).",
      },
      { status: 400 },
    );
  }

  let body: { mailbox?: string; days?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine
  }

  try {
    const emails = await fetchRecentAlerts({ mailbox: body.mailbox, days: body.days });
    const payloads: IngestPayload[] = [];
    const bySender: Record<string, number> = {};
    for (const e of emails) {
      const ps = parseAlertEmail(e);
      for (const p of ps) bySender[p.source] = (bySender[p.source] || 0) + 1;
      payloads.push(...ps);
    }
    const added = payloads.length
      ? await ingestPostings(payloads.map(payloadToPosting))
      : 0;
    return Response.json({
      emails: emails.length,
      parsedPostings: payloads.length,
      added,
      bySource: bySender,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Email sync failed." },
      { status: 502 },
    );
  }
}
