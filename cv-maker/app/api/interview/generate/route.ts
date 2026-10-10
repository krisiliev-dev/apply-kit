import { generateObject } from "ai";
import { z } from "zod";
import type { Application, InterviewPrep } from "@/lib/app/types";
import type { CVContent } from "@/lib/types";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/interview/generate
// Generates a structured set of likely interview questions for a role at a
// company, plus STAR-format answers sourced from the user's real CV. The UI
// surfaces these as a practice deck on the application detail page once the
// application moves to screen/interview/offer.
//
// Request:
//   {
//     applicationId: string,
//     application: Application,     // carries company, role, parsedJob, notes
//     baseCV: CVContent,            // source of STAR answers
//     questionCount?: number,       // default 12
//     companyNotes?: string,        // optional free-form research the user pasted
//   }
// Response:
//   { prep: InterviewPrep }

export const runtime = "nodejs";
export const maxDuration = 90;

const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 24;
const DEFAULT_QUESTIONS = 12;

const starSchema = z.object({
  situation: z
    .string()
    .describe("1–2 sentence setup. Name the team / product / constraint."),
  task: z
    .string()
    .describe("What the user had to do. Keep it sharp and specific."),
  action: z
    .string()
    .describe(
      "What the user actually did. Concrete verbs, specific technologies or moves. 2–4 sentences.",
    ),
  result: z
    .string()
    .describe(
      "What changed. Numbers if the CV has them — never invent metrics.",
    ),
  sourcedFrom: z
    .string()
    .optional()
    .describe(
      "The source in the base CV for this answer, e.g. 'experience: Senior Frontend Engineer at Quill & Compass'.",
    ),
});

const questionSchema = z.object({
  question: z
    .string()
    .describe("The question itself, verbatim as the interviewer would ask."),
  kind: z
    .enum([
      "behavioral",
      "technical",
      "system-design",
      "values",
      "situational",
      "culture-fit",
      "other",
    ])
    .describe("The kind of question. Controls how the UI tags it."),
  rationale: z
    .string()
    .describe(
      "1–2 sentences on why THIS company / role likely asks this question. Ground in the job posting, company stage, or public signals when available.",
    ),
  starAnswer: starSchema
    .optional()
    .describe(
      "STAR-format practice answer sourced strictly from the user's CV. Omit if no truthful source exists.",
    ),
});

const companyResearchSchema = z.object({
  summary: z
    .string()
    .describe(
      "3–5 sentence characterisation of the company based on the posting + any pasted notes. Stage, product focus, likely interview culture.",
    ),
  publicSignals: z
    .array(z.object({ source: z.string(), note: z.string() }))
    .describe(
      "Short distilled signals (1 line each) derived only from the posting and the user's pasted notes. Use 'posting' as a source label for signals from the JD; otherwise use the source the user gave.",
    ),
  likelyInterviewStyle: z
    .string()
    .optional()
    .describe(
      "A one-sentence read on the likely interview style (e.g. 'Collaborative pairing on a real codebase; values pragmatism over depth').",
    ),
});

const responseSchema = z.object({
  companyResearch: companyResearchSchema,
  questions: z.array(questionSchema),
});

type Body = {
  applicationId: string;
  application: Application;
  baseCV: CVContent;
  questionCount?: number;
  companyNotes?: string;
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.application || !body?.baseCV) {
    return json(
      { error: "Missing `application` or `baseCV` in body." },
      400,
    );
  }

  let resolved;
  try {
    resolved = resolveForRoute("default", body);
  } catch (err) {
    return respondProviderError(err, {
      feature: "default",
      settings: body.settings,
    });
  }

  const questionCount = clamp(
    Number.isFinite(body.questionCount)
      ? Math.round(body.questionCount as number)
      : DEFAULT_QUESTIONS,
    MIN_QUESTIONS,
    MAX_QUESTIONS,
  );

  const companyNotes =
    typeof body.companyNotes === "string"
      ? body.companyNotes.trim().slice(0, 6000)
      : "";

  try {
    const { object, usage } = await generateObject({
      model: resolved.model,
      schema: responseSchema,
      schemaName: "InterviewPrep",
      schemaDescription:
        "A structured interview prep deck: likely questions + STAR practice answers sourced from the user's real CV.",
      system: buildSystemPrompt(questionCount),
      prompt: buildUserPrompt(body.application, body.baseCV, companyNotes),
    });

    const prep: InterviewPrep = {
      generatedAt: Date.now(),
      companyResearch: object.companyResearch,
      questions: object.questions.map((q, i) => ({
        id: `q_${Date.now().toString(36)}_${i.toString(36)}`,
        question: q.question,
        kind: q.kind,
        rationale: q.rationale,
        starAnswer: q.starAnswer,
      })),
    };

    return jsonWithUsage(
      { prep },
      { feature: resolved.feature, choice: resolved.choice, usage },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

// ——————————————————————————————————————————————
// Prompts
// ——————————————————————————————————————————————

function buildSystemPrompt(questionCount: number): string {
  return `You prepare candidates for specific interviews at specific companies. You are not generic. Your output must read like it was written by someone who has actually looked at the job posting and the candidate's CV.

HARD RULES — violations are a failed generation.

1. No fabrication. Never invent experience, companies, projects, or metrics for the STAR answers. Every STAR must be traceable to a real entry in the user's base CV.
2. If no good CV source exists for a question, DO NOT produce a starAnswer. Instead, include in the rationale the phrase: "User should prepare this from outside the current CV." The question still stands.
3. Questions must be specific to this role at this company. Avoid "tell me about yourself" unless you explicitly frame it around a signal from the posting.

QUESTION MIX for ${questionCount} total:
- ~50% behavioral (STAR-shaped stories — collaboration, failure, ambiguity, scope, conflict)
- ~25% technical (only if the role is technical — calibrate from the posting; otherwise shift weight to behavioral/situational)
- ~15% values / culture-fit (why THIS company; tradeoffs you've made; what attracted you to this stage/size)
- ~10% situational (how would you approach X on day 30, given the stack/team described)

For each question:
- \`question\`: how an interviewer would actually phrase it. Not a topic.
- \`kind\`: the category above. "system-design" is separate from "technical" — use it for roles where architecture rounds are standard.
- \`rationale\`: 1–2 sentences. Say WHY this company / role is likely to ask this. Ground it in the JD's requirements, the company's stage/product, or the candidate's own CV (if there's an obvious follow-up trap).
- \`starAnswer\`: only when a truthful source exists in the CV. Pull real context. ~120–180 words total across the four STAR fields. Result should lean on the numbers the CV actually carries; do not invent.
- \`sourcedFrom\`: name the exact source inside the CV, e.g. "experience: Senior Frontend Engineer at Quill & Compass" or "project: tiny-crdt".

Company research block:
- Distil the posting + any notes the user pasted into a short characterisation. Do not repeat the whole JD.
- publicSignals: short items only. Tag them with a source. "posting" for signals lifted from the JD, otherwise the user-supplied source label.
- likelyInterviewStyle: one line, from the vibe of the posting and notes.

STYLE:
- STAR answers use "I" voice. Concrete verbs. No marketing phrasing, no "passionate", "results-driven", "dynamic".
- Rationales are short. This is a deck, not an essay.`;
}

function buildUserPrompt(
  app: Application,
  cv: CVContent,
  companyNotes: string,
): string {
  const lines: string[] = [];
  lines.push(`Company: ${app.company}`);
  lines.push(`Role: ${app.role}`);
  if (app.url) lines.push(`Posting URL: ${app.url}`);
  if (app.notes) lines.push(`User's own notes on this application: ${app.notes}`);

  if (app.jobData) {
    const j = app.jobData;
    lines.push("");
    lines.push("Parsed job posting:");
    lines.push(`Title: ${j.title}`);
    lines.push(`Company: ${j.company}`);
    if (j.location) lines.push(`Location: ${j.location}`);
    if (j.salary) lines.push(`Salary: ${j.salary}`);
    if (j.description) lines.push(`\n${j.description}`);
    if (j.requirements.length) {
      lines.push("");
      lines.push("Requirements:");
      lines.push(...j.requirements.map((r) => `- ${r}`));
    }
    if (j.responsibilities.length) {
      lines.push("");
      lines.push("Responsibilities:");
      lines.push(...j.responsibilities.map((r) => `- ${r}`));
    }
    if (j.niceToHave?.length) {
      lines.push("");
      lines.push("Nice to have:");
      lines.push(...j.niceToHave.map((r) => `- ${r}`));
    }
    if (j.keywords.length) {
      lines.push("");
      lines.push(`Keywords: ${j.keywords.join(", ")}`);
    }
  } else {
    lines.push(
      "\n(No parsed job on file. Reason about role + company from the basic metadata above plus any public signals you can plausibly infer from the company name and the user's notes.)",
    );
  }

  if (companyNotes) {
    lines.push("");
    lines.push("User-pasted company notes (URLs, Glassdoor quotes, blog excerpts):");
    lines.push(companyNotes);
  }

  lines.push("");
  lines.push("———");
  lines.push("");
  lines.push("Candidate's base CV (the only source you can draw STAR answers from):");
  lines.push(JSON.stringify(cv, null, 2));

  lines.push("");
  lines.push("Produce the prep deck now.");
  return lines.join("\n");
}

// ——————————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————————

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
