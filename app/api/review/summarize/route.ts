import { generateText } from "ai";
import type {
  FunnelCounts,
  RecurringLesson,
  ResponseHistogram,
  StallPattern,
  VariantPerformance,
  WeekBucket,
} from "@/lib/app/analytics";
import type { Settings } from "@/lib/settings/types";
import {
  jsonWithUsage,
  resolveForRoute,
  respondProviderError,
} from "@/lib/ai/route";

// POST /api/review/summarize
// Streams a concise 3-5 sentence diagnostic built from the aggregate numbers.
// The caller is the /applications/review page — it computes the numbers
// client-side from localStorage and sends them here.

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  funnel: FunnelCounts;
  weekly: WeekBucket[];
  histogram: ResponseHistogram;
  variants: VariantPerformance[];
  stall: StallPattern;
  lessons: RecurringLesson[];
  settings?: Settings;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!body?.funnel) {
    return json({ error: "Missing funnel data." }, 400);
  }

  if (body.funnel.total === 0) {
    return json({
      summary:
        "No applications in the last 90 days to review. Log a few outcomes and come back — the patterns only appear with signal.",
    });
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

  const system = `You are a career-strategy reviewer. You look at 90 days of job-application data and write a short diagnostic.

Hard rules:
- 3 to 5 sentences TOTAL. No bullet points, no headers, no lists.
- Be specific to the numbers in front of you. No generic advice ("keep applying!", "network more").
- If one stage concentrates losses, name it. If one CV variant outperforms, name it. If response rate is collapsing week over week, say so.
- End with ONE concrete adjustment to try next quarter. Not three, not a menu — pick one.
- No filler phrases. No "overall", "in summary", "it seems". Just say the thing.
- Write in second person ("you").`;

  const funnelBlock = describeFunnel(body.funnel);
  const variantBlock = describeVariants(body.variants);
  const stallBlock = describeStall(body.stall);
  const weeklyBlock = describeWeekly(body.weekly);
  const histogramBlock = describeHistogram(body.histogram);
  const lessonsBlock = describeLessons(body.lessons);

  const prompt = `Last 90 days of application data:

${funnelBlock}

${weeklyBlock}

${histogramBlock}

${variantBlock}

${stallBlock}

${lessonsBlock}

Write the diagnostic now — 3 to 5 sentences, ending with one concrete adjustment.`;

  try {
    const { text, usage } = await generateText({
      model: resolved.model,
      system,
      prompt,
    });
    return jsonWithUsage(
      { summary: text.trim() },
      { feature: resolved.feature, choice: resolved.choice, usage },
    );
  } catch (e) {
    return respondProviderError(e, {
      feature: resolved.feature,
      choice: resolved.choice,
    });
  }
}

function describeFunnel(f: FunnelCounts): string {
  return `Funnel:
- Total applications: ${f.total}
- Reached screen: ${f.screen}
- Reached interview: ${f.interview}
- Reached offer: ${f.offer}
- Rejected: ${f.rejected}
- Withdrawn: ${f.withdrawn}
- Ghosted: ${f.ghosted}`;
}

function describeVariants(variants: VariantPerformance[]): string {
  if (variants.length === 0) return "Variant performance: no data.";
  const lines = variants
    .slice(0, 5)
    .map(
      (v) =>
        `- ${v.cvSlug}: ${v.applied} applied → ${v.screen} screen → ${v.interview} interview → ${v.offer} offer (response ${Math.round(
          v.responseRate * 100,
        )}%, interview ${Math.round(v.interviewRate * 100)}%)`,
    )
    .join("\n");
  return `CV variant performance:\n${lines}`;
}

function describeStall(s: StallPattern): string {
  if (s.totalLosses === 0) return "Stall pattern: no closed losses yet.";
  const counts = `resume ${s.counts.resume} · screen ${s.counts.screen} · interview ${s.counts.interview} · final ${s.counts.final} · offer ${s.counts.offer}`;
  const flag = s.flag ? `\nFlag: ${s.flag}` : "";
  return `Stall pattern (${s.totalLosses} total losses): ${counts}${flag}`;
}

function describeWeekly(weekly: WeekBucket[]): string {
  const lines = weekly
    .map((w) => `- ${w.label}: ${w.sent} sent, ${w.responded} responded`)
    .join("\n");
  return `Weekly trend (last 13 weeks):\n${lines}`;
}

function describeHistogram(h: ResponseHistogram): string {
  if (h.sampleCount === 0) return "Time-to-response: no responses yet.";
  const bars = h.buckets
    .map((b) => `${b.label}: ${b.count}`)
    .join(" · ");
  return `Time-to-response (${h.sampleCount} samples, median ${h.medianDays ?? "—"}d): ${bars}`;
}

function describeLessons(lessons: RecurringLesson[]): string {
  if (lessons.length === 0) return "Recurring lessons: none yet.";
  const lines = lessons
    .map((l) => `- (×${l.occurrences}) ${l.text}`)
    .join("\n");
  return `Recurring lessons across recent rejections:\n${lines}`;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
