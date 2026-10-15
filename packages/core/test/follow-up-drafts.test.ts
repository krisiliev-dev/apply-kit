// Follow-up drafts in the user's voice (Track #32), at the tracker's public interface: a draft comes
// from the Track assistant (a fake answering with recorded drafts) within the shared monthly AI budget,
// with the posting's requirements, Master profile evidence, voice excerpts and the posting's language;
// numbers only from the Master profile, with their origin; the outline when the budget is out; edits
// kept as voice samples. Fake clock (Mon 12 Oct 2026, 10:30 in Sofia), in-memory database, fixture
// HTTP (a synthetic Greenhouse board), no live AI.
import { describe, expect, it } from "vitest";
import {
  createTracker, type DraftInput, type MasterProfile, type ProfileEvidence, type TrackAssistant, type VoiceSamples,
} from "../src/index.ts";
import { cannedFacts, createTestEngine, fakeExtractor, fixtureFetch } from "./harness.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";
const day = 24 * 60 * 60 * 1000;
const q = (quote: string) => ({ quote, translation: null });

/** What Kestrel's Security Engineer posting asks for (recorded reading). */
const securityEngineer = cannedFacts({
  requirements: [
    { text: "Threat modelling for payment features", kind: "required", category: "skill", source: q("threat-model new payment features with product teams"), confidence: 0.95 },
    { text: "Cloud security (AWS)", kind: "required", category: "skill", source: q("AWS security"), confidence: 0.9 },
  ],
});
/** The SOC Analyst posting, read as Bulgarian. */
const socAnalyst = cannedFacts({
  language: "bg",
  requirements: [{ text: "SIEM monitoring", kind: "required", category: "skill", source: q("наблюдение на SIEM"), confidence: 0.9 }],
});

/** Mira's Master profile (made up), answering with every piece it has. */
const evidence: ProfileEvidence[] = [
  { text: "Ran threat-modelling sessions for card-payment services; 40 tracked fixes", origin: "Velora · Security Engineer (2022–2024)" },
];
const profile: MasterProfile = { evidence: async () => evidence };

const nudgeBody = (detail: string) =>
  `I applied for the Security Engineer role on 5 October and I'm still keen on it. ${detail} At Velora I ran threat-modelling sessions for our card-payment services and turned the findings into 40 tracked fixes, so it's work I'd enjoy doing again. I'm happy to share more about it, and I'm free for a call any weekday this month.`;

/** The fake Track assistant: answers each draft with a recorded body (or an error), and records what it was sent. */
function fakeAssistant({ costUsd = 0.002, body = nudgeBody("Your posting's focus on threat-modelling new payment features stood out.") }: { costUsd?: number; body?: string | ((i: DraftInput) => string) } = {}) {
  const inputs: DraftInput[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => 0.0005,
    classify: async () => { throw new Error("not in these tests"); },
    estimateDraftUsd: () => costUsd,
    async draft(input) {
      inputs.push(input);
      return { draft: { body: typeof body === "function" ? body(input) : body }, costUsd, model: "fake/track-assistant" };
    },
  };
  return { assistant, inputs };
}

function setup({ cap = 10, ai = fakeAssistant(), withProfile = true, voice }: { cap?: number; ai?: ReturnType<typeof fakeAssistant>; withProfile?: boolean; voice?: VoiceSamples } = {}) {
  const extractor = fakeExtractor({ "Security Engineer": securityEngineer, "SOC Analyst L2": socAnalyst });
  const t = createTestEngine({ fetch: fixtureFetch({ [kestrelBoard]: "greenhouse-kestrel.json" }), extractor, aiMonthlyCapUsd: cap });
  const tracker = createTracker({
    db: t.deps.db, clock: t.clock, discovery: t.engine, assistant: ai.assistant, aiMonthlyCapUsd: cap,
    profile: withProfile ? profile : undefined, voice,
  });
  /** Applies to a Kestrel job (read first), 7 days ago, and returns its due nudge's id. */
  let checked = false;
  const applyTo = async (title: string, { appliedOn = "2026-10-05", contact = "careers@kestrel-payments.example" } = {}) => {
    if (!checked) {
      checked = true;
      await t.engine.addSource({ kind: "greenhouse", config: "kestrel" });
      await t.engine.checkAll();
      await t.engine.readPending();
    }
    const job = (await t.engine.queryFeed({ view: "new" })).jobs.find((j) => j.title === title)!;
    const r = await tracker.addByHand({ job: { jobId: job.id }, appliedOn, status: "applied", how: "i-applied", contact });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return { applicationId: r.application.id, followUpId: (await tracker.get(r.application.id))!.followUp!.id };
  };
  return { ...t, tracker, ai, applyTo };
}

describe("a follow-up draft from the Track assistant", () => {
  it("drafts the nudge within the budget, with the posting's requirements, the Master profile evidence and the posting's language", async () => {
    const { tracker, ai, applyTo } = setup();
    const { followUpId } = await applyTo("Security Engineer");

    const fu = (await tracker.followUp(followUpId))!;

    expect(fu.draft?.text).toBe(nudgeBody("Your posting's focus on threat-modelling new payment features stood out."));
    expect(fu.text).toBe(fu.draft!.text);
    expect(fu.noDraft).toBeNull();
    expect(ai.inputs).toHaveLength(1);
    expect(ai.inputs[0]).toMatchObject({
      kind: "nudge", company: "Kestrel Payments", title: "Security Engineer", language: "en", words: { min: 70, max: 110 },
      requirements: ["Threat modelling for payment features", "Cloud security (AWS)"],
      evidence,
    });
    expect(ai.inputs[0]!.banned).toEqual(expect.arrayContaining(["I'm thrilled", "as per my previous email"]));
  });

  it("names where each number about the user came from, and allows the date applied", async () => {
    const { tracker, applyTo } = setup();
    const { followUpId } = await applyTo("Security Engineer");

    const fu = (await tracker.followUp(followUpId))!;

    expect(fu.draft!.numbers).toEqual([{ quote: "40 tracked fixes", origin: "Velora · Security Engineer (2022–2024)" }]);
  });

  it("is made once: opening it again (or twice at once) doesn't ask the assistant again", async () => {
    const { tracker, ai, applyTo } = setup();
    const { followUpId } = await applyTo("Security Engineer");

    await Promise.all([tracker.followUp(followUpId), tracker.followUp(followUpId)]);
    await tracker.followUp(followUpId);

    expect(ai.inputs).toHaveLength(1);
  });

  it("is in the posting's language: Bulgarian for a Bulgarian posting", async () => {
    const { tracker, ai, applyTo } = setup({ ai: fakeAssistant({ body: "Кандидатствах за позицията SOC Analyst L2 на 5 октомври и все още много ме интересува. Опитът ми с наблюдение на SIEM е точно това, което търсите." }) });
    const { followUpId } = await applyTo("SOC Analyst L2");

    const fu = (await tracker.followUp(followUpId))!;

    expect(ai.inputs[0]).toMatchObject({ language: "bg", requirements: ["SIEM monitoring"] });
    expect(fu.draft).toMatchObject({ language: "bg" });
  });

  it("shows the text as the user typed it over the draft", async () => {
    const { tracker, applyTo } = setup();
    const { followUpId } = await applyTo("Security Engineer");
    await tracker.followUp(followUpId);

    await tracker.saveFollowUpText(followUpId, "My own words.");

    expect((await tracker.followUp(followUpId))!.text).toBe("My own words.");
  });
});

describe("a draft that breaks the rules is never shown", () => {
  it("a number that isn't in the Master profile: the outline stands in, and says why", async () => {
    const { tracker, applyTo } = setup({ ai: fakeAssistant({ body: nudgeBody("I cut incident response time by 63% in my last role.") }) });
    const { followUpId } = await applyTo("Security Engineer");

    const fu = (await tracker.followUp(followUpId))!;

    expect(fu.draft).toBeNull();
    expect(fu.text).toBe("");
    expect(fu.noDraft).toEqual({ reason: "failed", why: "it used a number (63%) that isn't in your Master profile" });
    expect(fu.outline[0]).toBe("Applied for Security Engineer on Mon 5 Oct; still interested.");
  });

  it("a banned phrase", async () => {
    const { tracker, applyTo } = setup({ ai: fakeAssistant({ body: nudgeBody("I'm thrilled about the role.") }) });
    const { followUpId } = await applyTo("Security Engineer");

    expect((await tracker.followUp(followUpId))!.noDraft).toEqual({ reason: "failed", why: 'it used "I\'m thrilled"' });
  });

  it("with no Master profile, any number about the user is refused", async () => {
    const { tracker, applyTo } = setup({ withProfile: false });
    const { followUpId } = await applyTo("Security Engineer");

    const fu = (await tracker.followUp(followUpId))!;

    expect(fu.noDraft).toMatchObject({ reason: "failed" });
  });
});

describe("the AI budget", () => {
  it("is checked before drafting: once it's used up there's no assistant call, the outline instead, and when it ran out and resets", async () => {
    const ai = fakeAssistant({ costUsd: 0.6 });
    // Reading Kestrel's three postings costs 0.003; the first draft fits in the 1 USD cap, the second doesn't.
    const { tracker, applyTo, clock } = setup({ cap: 1, ai });
    const first = await applyTo("Security Engineer");
    const second = await applyTo("SOC Analyst L2");

    expect((await tracker.followUp(first.followUpId))!.draft).not.toBeNull();
    await clock.advance(2 * day); // Wed 14 Oct
    const fu = (await tracker.followUp(second.followUpId))!;

    expect(ai.inputs).toHaveLength(1);
    expect(fu.draft).toBeNull();
    expect(fu.noDraft).toEqual({ reason: "budget-out", capUsd: 1, ranOutOn: "2026-10-12", resetsOn: "2026-11-01" });
    expect(fu.outline.length).toBeGreaterThan(0);
  });

  it("with no AI budget set, nothing is drafted", async () => {
    const { tracker, ai, applyTo } = setup({ cap: 0 });
    const { followUpId } = await applyTo("Security Engineer");

    expect((await tracker.followUp(followUpId))!.noDraft).toEqual({ reason: "no-ai" });
    expect(ai.inputs).toHaveLength(0);
  });
});

describe("the user's voice", () => {
  it("edits to a draft are kept as voice samples and sent, as short excerpts, with the next draft; a draft left as it came isn't", async () => {
    const prepare: VoiceSamples = { excerpts: async () => ["A past cover letter of mine, in my words."] };
    const { tracker, ai, applyTo } = setup({ voice: prepare });
    const first = await applyTo("Security Engineer");
    const fu = (await tracker.followUp(first.followUpId))!;
    await tracker.saveFollowUpText(first.followUpId, fu.text.replace("I'm still keen on it", "it's still the role I want most"));
    const second = await applyTo("SOC Analyst L2");
    ai.inputs.length = 0;

    await tracker.followUp(second.followUpId);

    expect(ai.inputs[0]!.voice).toEqual([
      expect.stringContaining("it's still the role I want most"),
      "A past cover letter of mine, in my words.",
    ]);
  });

  it("a draft saved unchanged teaches nothing", async () => {
    const { tracker, ai, applyTo } = setup();
    const first = await applyTo("Security Engineer");
    const fu = (await tracker.followUp(first.followUpId))!;
    await tracker.saveFollowUpText(first.followUpId, fu.text);
    const second = await applyTo("SOC Analyst L2");

    await tracker.followUp(second.followUpId);

    expect(ai.inputs.at(-1)!.voice).toEqual([]);
  });
});
