// Track drafting from Prepare's own master profile and voice, wired as the service wires them:
// the tracker's profile and voice ports made from the preparation engine through `PrepareForTrack`
// (`trackPortsFrom`). Both engines and the tracker share one in-memory database, fake clock and AI
// budget; the fake Track assistant records what it was sent. Every person and employer is made up.
import { describe, expect, it } from "vitest";
import { createTracker, trackPortsFrom, type DraftInput, type LearnedVoice, type PrepSheetInput, type TrackAssistant, type VoiceLearningInput } from "../src/index.ts";
import { cannedFacts, fakeExtractor, fixtureFetch, memoryDb } from "./harness.ts";
import { createTestPreparation, fakeWriter, type TestPreparationOptions } from "./preparation-harness.ts";

const kestrelBoard = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs?content=true";
const q = (quote: string) => ({ quote, translation: null });

/** What Kestrel's Security Engineer posting asks for (recorded reading). */
const securityEngineer = cannedFacts({
  requirements: [
    { text: "Threat modelling for payment features", kind: "required", category: "skill", source: q("threat-model new payment features with product teams"), confidence: 0.95 },
  ],
});

const body = "I applied for the Security Engineer role on 5 October and I'm still keen on it. At Velora I ran threat-modelling sessions for our card-payment services and turned the findings into 40 tracked fixes, so it's work I'd enjoy doing again. I'm happy to share more about it, and I'm free for a call any weekday this month if that helps.";

function fakeAssistant() {
  const inputs: DraftInput[] = [];
  const prepInputs: PrepSheetInput[] = [];
  const assistant: TrackAssistant = {
    estimateClassifyUsd: () => 0.0005,
    classify: async () => { throw new Error("not in these tests"); },
    estimatePrepSheetUsd: () => 0.002,
    async buildPrepSheet(input) {
      prepInputs.push(input);
      // One question answered by the first story it was given, one with no story yet.
      const sheet = {
        facts: [],
        questions: [
          { requirement: "Threat modelling", question: "Tell us about a threat model you ran.", storyId: input.stories[0]?.id ?? null },
          { requirement: "Cloud security (AWS)", question: "How do you review an AWS account?", storyId: null },
        ],
      };
      return { sheet, costUsd: 0.002, model: "fake/track-assistant" };
    },
    estimateDraftUsd: () => 0.002,
    async draft(input) {
      inputs.push(input);
      return { draft: { body }, costUsd: 0.002, model: "fake/track-assistant" };
    },
  };
  return { assistant, inputs, prepInputs };
}

function setup(options: TestPreparationOptions = {}) {
  const db = memoryDb();
  const t = createTestPreparation({
    db,
    fetch: fixtureFetch({ [kestrelBoard]: "greenhouse-kestrel.json" }),
    extractor: fakeExtractor({ "Security Engineer": securityEngineer }),
    ...options,
  });
  const ai = fakeAssistant();
  const tracker = createTracker({
    db, clock: t.clock, discovery: t.discovery, assistant: ai.assistant, aiMonthlyCapUsd: 10,
    ...trackPortsFrom(t.preparation),
  });
  /** Applies to Kestrel's Security Engineer job (read first), 7 days ago; returns its due nudge's id. */
  const applyToKestrel = async () => {
    await t.discovery.addSource({ kind: "greenhouse", config: "kestrel" });
    await t.discovery.checkAll();
    await t.discovery.readPending();
    const job = (await t.discovery.queryFeed({ view: "new" })).jobs.find((j) => j.title === "Security Engineer")!;
    const r = await tracker.addByHand({ job: { jobId: job.id }, appliedOn: "2026-10-05", status: "applied", how: "i-applied", contact: "careers@kestrel-payments.example" });
    if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    return { applicationId: r.application.id, followUpId: (await tracker.get(r.application.id))!.followUp!.id };
  };
  return { ...t, tracker, ai, applyToKestrel };
}

/** Mira's role at Velora and its threat-modelling achievement (40 tracked fixes), both confirmed. */
function addVeloraPieces(t: ReturnType<typeof setup>) {
  const role = t.preparation.savePiece({ kind: "role", text: "", entry: { title: "Security Engineer", organisation: "Velora", city: "Sofia", start: "2022-03", end: "2024-06" } });
  if (!role.saved) throw new Error("role not saved");
  t.preparation.savePiece({
    kind: "achievement", belongsTo: role.piece.id, numberSource: "measured", tags: ["threat modelling", "payments"],
    text: "Ran threat-modelling sessions for card-payment services; 40 tracked fixes",
  });
}

describe("a follow-up draft from Prepare's master profile", () => {
  it("is sent the confirmed pieces that bear on the posting, each with where it comes from; an unconfirmed piece isn't", async () => {
    const t = setup();
    addVeloraPieces(t);
    t.preparation.addUnconfirmedPiece({ text: "Threat modelling for a payments start-up, 12 features", source: "Prep sheet for SOC Analyst at Orbital" });
    const { followUpId } = await t.applyToKestrel();

    await t.tracker.followUp(followUpId);

    expect(t.ai.inputs[0]!.evidence).toEqual([
      { text: "Ran threat-modelling sessions for card-payment services; 40 tracked fixes", origin: "Security Engineer · Velora, Sofia · Mar 2022 – Jun 2024" },
    ]);
  });
});

describe("the prep sheet with Prepare's master profile", () => {
  it("answers questions with Kris's confirmed achievements, and a story added there waits in Profile, unconfirmed, with its source", async () => {
    const t = setup();
    const role = t.preparation.savePiece({ kind: "role", text: "", entry: { title: "Security Engineer", organisation: "Velora", city: "Sofia", start: "2022-03", end: "2024-06" } });
    if (!role.saved) throw new Error("role not saved");
    const story = t.preparation.savePiece({ kind: "achievement", belongsTo: role.piece.id, text: "Led the threat model for Velora's card vault before launch." });
    if (!story.saved) throw new Error("story not saved");
    const added = await t.tracker.addByHand({ job: { company: "Orbital Freight", title: "Cloud Security Engineer" }, appliedOn: "2026-10-05", status: "interviewing", how: "by-hand" });
    if (added.outcome !== "added") throw new Error(`not added: ${added.outcome}`);

    const sheet = await t.tracker.buildPrepSheet(added.application.id);
    await t.tracker.addPrepStory(added.application.id, sheet.questions[1]!.id, "Reviewed IAM policies across 30 AWS accounts at Velora.");

    expect(t.ai.prepInputs[0]!.stories).toEqual([{ id: story.piece.id, text: "Led the threat model for Velora's card vault before launch.", where: "Velora · 2022" }]);
    expect(sheet.questions[0]!.story).toMatchObject({ id: story.piece.id });
    const waiting = t.preparation.listPieces({ search: "IAM policies" }).groups.flatMap((g) => g.pieces);
    expect(waiting).toEqual([expect.objectContaining({
      text: "Reviewed IAM policies across 30 AWS accounts at Velora.", status: "unconfirmed",
      source: expect.objectContaining({ from: "Prep sheet for Cloud Security Engineer at Orbital Freight: \"How do you review an AWS account?\"" }),
    })]);
  });
});

/** The writer learns this rule from the first excerpt of any call. */
const learnsRule = (rule: string) => (input: VoiceLearningInput): LearnedVoice => ({
  rules: [{ id: null, text: rule, evidence: "samples", language: null, sources: [input.excerpts[0]!.source] }],
});

describe("a follow-up draft in Kris's voice, from Prepare", () => {
  it("is sent Prepare's voice rules and excerpts in the posting's language, on record as sent for a follow-up", async () => {
    const t = setup({ writer: fakeWriter({ learnVoice: learnsRule("Short declarative sentences") }) });
    await t.preparation.addVoiceSamples([{ fileName: "about-page.txt", bytes: new TextEncoder().encode("I build small tools that make noisy systems quieter. Most of my work is reading logs nobody reads.") }]);
    await t.preparation.learnVoice();
    const { followUpId } = await t.applyToKestrel();

    await t.tracker.followUp(followUpId);

    expect(t.ai.inputs[0]!.voiceRules).toEqual(["Short declarative sentences"]);
    expect(t.ai.inputs[0]!.voice).toEqual(["I build small tools that make noisy systems quieter. Most of my work is reading logs nobody reads."]);
    expect(t.preparation.voiceSends()[0]).toMatchObject({ purpose: "follow-up", language: "en" });
  });

  it("records what Kris sent, changed from the draft, as one voice edit when it's marked sent", async () => {
    const t = setup();
    addVeloraPieces(t);
    const { followUpId } = await t.applyToKestrel();
    const fu = (await t.tracker.followUp(followUpId))!;
    expect(fu.draft?.text).toBe(body);
    await t.tracker.saveFollowUpText(followUpId, fu.text.replace("I'm still keen on it", "it's still the role I want most"));
    await t.tracker.saveFollowUpText(followUpId, fu.text.replace("I'm still keen on it", "it is still the role I want most"));

    await t.tracker.markFollowUpSent(followUpId);

    expect(t.preparation.voice().edits).toEqual({ total: 1, sources: 1, waiting: 1 });
  });

  it("a draft sent as it came teaches nothing", async () => {
    const t = setup();
    addVeloraPieces(t);
    const { followUpId } = await t.applyToKestrel();
    expect((await t.tracker.followUp(followUpId))!.draft?.text).toBe(body);

    await t.tracker.markFollowUpSent(followUpId);

    expect(t.preparation.voice().edits.total).toBe(0);
  });
});
