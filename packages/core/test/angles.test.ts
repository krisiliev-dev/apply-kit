import { describe, expect, it } from "vitest";
import type { PieceInput } from "../src/index.ts";
import { createTestPreparation } from "./preparation-harness.ts";

// Angles through the preparation engine (ticket #58). Made-up people and companies only.

/** Elin Varga's made-up profile: a security role with results, some developer work, little design. */
function elinProfile(options: Parameters<typeof createTestPreparation>[0] = {}) {
  const t = createTestPreparation(options);
  const ids: Record<string, string> = {};
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Harbour Mutual", city: "Plovdiv", start: "2022-02", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM", "Wazuh"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("triage", { kind: "achievement", text: "Triaged about 20 alerts a day for a team of 5.", belongsTo: ids.analyst, tags: ["triage"], angles: ["security"], numberSource: "estimate" });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  save("shop", { kind: "achievement", text: "Built an online shop in Vue for a bakery.", tags: ["Vue"], angles: ["developer", "design"] });
  save("typescript", { kind: "skill", text: "TypeScript", angles: ["developer"] });
  return { ...t, ids };
}

describe("choosing the closest angle for a job", () => {
  it("picks Security for a security posting, with the reason", () => {
    const t = elinProfile();

    const choice = t.preparation.closestAngle({
      title: "SOC Analyst",
      titleTranslation: null,
      requirements: [{ text: "Hands-on experience with a SIEM, ideally Wazuh" }, { text: "Calm under pressure during incident response" }],
    });

    expect(choice.angle).toBe("security");
    expect(choice.reason).toBe("The posting says “soc”, “siem”, “incident response”, and your security pieces are tagged “Wazuh”.");
  });
});

describe("the three angles", () => {
  it("each has a summary line, the pieces that lead, the pieces available, packages that used it and whether it's thin", () => {
    const t = elinProfile();

    const [developer, security, design] = t.preparation.angles();

    expect(security).toMatchObject({ angle: "security", label: "Security", summary: "", available: 5, packagesUsed: 0 });
    // Before Kris orders them: achievements with a result first, then the other achievements, then roles.
    expect(security!.leads.map((p) => p.id)).toEqual([t.ids.detections, t.ids.triage, t.ids.phishing, t.ids.analyst]);
    expect(security!.thin).toEqual({ reason: "Only 5 pieces, and 2 have a result." });
    expect(developer).toMatchObject({ angle: "developer", available: 2, thin: { reason: "Only 2 pieces, and none has a result." } });
    expect(design).toMatchObject({ angle: "design", available: 1, thin: { reason: "Only 1 piece, and none has a result." } });
  });
});
