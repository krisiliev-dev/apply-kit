import { describe, expect, it } from "vitest";
import { bannedPhrases, type DraftInput, type EmailClassification } from "@apply-kit/core";
import { CHINA_HOSTED_PROVIDERS } from "./openrouter.ts";
import { createOpenRouterTrackAssistant } from "./track-assistant.ts";

// A synthetic email (made-up company and people); the API is faked, nothing touches the network.
const input = {
  messageId: "<rej-1@northwind-labs.example>", from: "Mira Petrova <mira.petrova@northwind-labs.example>",
  subject: "Your application for Security Engineer", receivedAt: "2026-10-14T09:12:00.000Z",
  text: "Thank you for applying. We have decided to move forward with other candidates.",
};
const classification: EmailClassification = {
  kind: "rejection", confidence: 0.95, company: "Northwind Labs", jobTitle: "Security Engineer", stage: null, language: "en", summary: null, interview: null,
};

function fakeOpenRouter(content: string = JSON.stringify(classification)) {
  const requests: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      id: "gen-1", object: "chat.completion", created: 1_760_000_000, model: "deepseek/deepseek-v4.1-flash", provider: "DeepInfra",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 400, completion_tokens: 60, total_tokens: 460, cost: 0.00012 },
    });
  };
  return { fetch, requests };
}

describe("OpenRouter Track assistant", () => {
  it("classifies on pinned non-China hosts, sending the sender, subject and text but not the Message-ID", async () => {
    const api = fakeOpenRouter();
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });

    const result = await assistant.classify(input);

    expect(result).toEqual({ classification, costUsd: 0.00012, model: "deepseek/deepseek-v4.1-flash" });
    const body = api.requests[0]!;
    expect(body.provider).toMatchObject({ data_collection: "deny", allow_fallbacks: false, ignore: CHINA_HOSTED_PROVIDERS });
    const sent = JSON.stringify(body.messages);
    expect(sent).toContain("Your application for Security Engineer");
    expect(sent).not.toContain("rej-1@northwind-labs.example");
  });

  it("estimates without calling, and throws on an answer that doesn't fit the schema", async () => {
    const api = fakeOpenRouter('{"kind": "maybe"}');
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });

    expect(assistant.estimateClassifyUsd(input)).toBeGreaterThan(0.00012);
    expect(api.requests).toHaveLength(0);
    await expect(assistant.classify(input)).rejects.toThrow();
  });

  it("builds a prep sheet from the posting, notes and stories it is given, sending story ids and texts but nothing else of the profile", async () => {
    const sheet = {
      facts: [{ text: "Booking software for private clinics.", source: "posting" }],
      questions: [{ requirement: "TypeScript", question: "Walk me through a codebase you made safer.", storyId: "piece-ts" }],
    };
    const api = fakeOpenRouter(JSON.stringify(sheet));
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });
    const prep = {
      company: "Medora", title: "Full-stack Engineer", postingText: "Booking software for private clinics.\nTypeScript, 2+ years.",
      requirements: [{ text: "TypeScript, 2+ years", kind: "required" as const }], notes: ["Liked the salary range."],
      stories: [{ id: "piece-ts", text: "Moved 40k lines to strict TypeScript", where: "Velora · 2023" }], language: "en",
    };

    expect(assistant.estimatePrepSheetUsd(prep)).toBeGreaterThan(0);
    const result = await assistant.buildPrepSheet(prep);

    expect(result).toEqual({ sheet, costUsd: 0.00012, model: "deepseek/deepseek-v4.1-flash" });
    const sent = JSON.stringify(api.requests[0]!.messages);
    expect(sent).toContain("piece-ts");
    expect(sent).toContain("Moved 40k lines to strict TypeScript");
  });
});

// A synthetic follow-up (made-up company, person and profile).
const draftInput: DraftInput = {
  followUpId: "fu-secret-id", kind: "nudge", company: "Kestrel Payments", title: "Security Engineer", since: "Mon 5 Oct", stage: "applied",
  daysQuiet: 7, requirements: ["Threat modelling for payment features"], notes: [], language: "en", words: { min: 70, max: 110 }, banned: bannedPhrases,
  evidence: [{ text: "Ran threat-modelling sessions; 40 tracked fixes", origin: "Velora · Security Engineer" }],
  voice: ["I keep things short and plain."],
};

describe("OpenRouter Track assistant: drafts", () => {
  it("drafts on pinned non-China hosts with the requirements, evidence, voice excerpts and banned phrases, but not the follow-up's id", async () => {
    const api = fakeOpenRouter(JSON.stringify({ body: "A short nudge." }));
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });

    const result = await assistant.draft(draftInput);

    expect(result).toEqual({ draft: { body: "A short nudge." }, costUsd: 0.00012, model: "deepseek/deepseek-v4.1-flash" });
    expect(assistant.estimateDraftUsd(draftInput)).toBeGreaterThan(0);
    const body = api.requests[0]!;
    expect(body.provider).toMatchObject({ data_collection: "deny", allow_fallbacks: false, ignore: CHINA_HOSTED_PROVIDERS });
    const sent = JSON.stringify(body.messages);
    for (const part of ["Threat modelling for payment features", "40 tracked fixes", "I keep things short and plain.", "as per my previous email", "70-110 words"]) {
      expect(sent).toContain(part);
    }
    expect(sent).not.toContain("fu-secret-id");
  });

  it("tells the model a thank-you note's interview, people and the topic discussed", async () => {
    const api = fakeOpenRouter(JSON.stringify({ body: "Thank you." }));
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });

    await assistant.draft({ ...draftInput, kind: "thank-you", stage: "interviewing", since: "Mon 12 Oct", topic: "IAM drift in Terraform", people: ["Ivo Marinov"], words: { min: 70, max: 130 } });

    const sent = JSON.stringify(api.requests[0]!.messages);
    for (const part of ["thank-you note after an interview on Mon 12 Oct with Ivo Marinov", "One thing discussed: IAM drift in Terraform", "70-130 words"]) {
      expect(sent).toContain(part);
    }
  });

  it("tells the model a withdrawal is after accepting another offer, never naming it, and a decline is declining this one", async () => {
    const api = fakeOpenRouter(JSON.stringify({ body: "Thank you." }));
    const assistant = createOpenRouterTrackAssistant({ apiKey: "test-key", fetch: api.fetch });

    await assistant.draft({ ...draftInput, kind: "withdrawal", stage: "interviewing", words: { min: 30, max: 70 } });
    await assistant.draft({ ...draftInput, kind: "decline", stage: "offer", words: { min: 40, max: 80 } });

    const withdrawal = JSON.stringify(api.requests[0]!.messages);
    for (const part of ["withdrawing from this process (now interviewing) after accepting another offer", "never name the other company", "30-70 words"]) {
      expect(withdrawal).toContain(part);
    }
    expect(JSON.stringify(api.requests[1]!.messages)).toContain("declining their offer");
  });
});
