import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import type { Application, FollowUpKind } from "@/lib/app/types";
import { FOLLOWUP_KIND_TONE } from "@/lib/app/followupCadence";
import { profile as baseProfile } from "@/content/profile";

// POST /api/follow-up/draft
// Body: { applicationId: string; application: Application; kind: FollowUpKind }
// Streams plain text as the email body. Client persists on stream end.

export const runtime = "nodejs";
export const maxDuration = 45;

type Body = {
  applicationId: string;
  application: Application;
  kind: FollowUpKind;
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "ANTHROPIC_API_KEY missing. Add it to .env.local and restart the dev server.",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body?.application || !body?.kind) {
    return new Response(
      JSON.stringify({ error: "Missing application or kind." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const { application: app, kind } = body;

  // post-offer is a candidate-facing reminder, not an email to the company.
  if (kind === "post-offer") {
    const system = `You write brief, calm reminder notes to the candidate (yourself) about offer response deadlines. This is a note-to-self, not an email.

Rules:
- Under 80 words.
- Plain text. No greeting, no sign-off.
- State the deadline context, one clarifying question the candidate should answer, and one action.
- Never syrupy. Never "you've got this".`;
    const prompt = `Context:\n- Company: ${app.company}\n- Role: ${app.role}\n- Current status: ${app.status}\n- Notes: ${app.notes ?? "(none)"}\n\nWrite the self-reminder now.`;
    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system,
      prompt,
    });
    return result.toTextStreamResponse();
  }

  const system = `You write follow-up emails that sound like a thoughtful candidate wrote them. Not templates. Not LinkedIn-flavour spam.

Hard rules:
- Output is PLAIN TEXT. Blank lines between paragraphs. No subject line, no greeting, no sign-off — the candidate composes those wrappers.
- Concise and warm, never fawning. No "I wanted to reach out to express my deep interest". No "as per my previous email". No em-dash clichés like "I'm thrilled".
- Reference a specific detail from the role or candidate's background — never generic.
- NEVER invent details that aren't in the application record. If there's nothing to reference, keep it brief and honest.
- Style for this follow-up kind: ${FOLLOWUP_KIND_TONE[kind] ?? ""}`;

  const context = [
    `Candidate: ${baseProfile.name} (${baseProfile.title ?? "professional"})`,
    `Company: ${app.company}`,
    `Role: ${app.role}`,
    `Current status: ${app.status}`,
    app.url ? `Posting URL: ${app.url}` : undefined,
    app.jobData?.requirements?.length
      ? `Top requirements: ${app.jobData.requirements.slice(0, 5).join("; ")}`
      : undefined,
    app.notes ? `Candidate notes: ${app.notes.slice(0, 400)}` : undefined,
    `Applied on: ${new Date(app.dateCreated).toDateString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `Application context:\n${context}\n\nFollow-up kind: ${kind}\n\nWrite the follow-up email body now. Plain text only.`;

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system,
    prompt,
  });

  return result.toTextStreamResponse();
}
