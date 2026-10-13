import { describe, expect, it } from "vitest";
import { createTestPreparation } from "./preparation-harness.ts";

// The master profile through the preparation engine (ticket #53). Made-up person only: Mira Petrova.

describe("profile pieces", () => {
  it("keeps a piece added by hand, confirmed, under the role it belongs to", async () => {
    const t = createTestPreparation();
    const role = t.preparation.savePiece({
      kind: "role",
      entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null },
      text: "",
      tags: ["SOC"],
      angles: ["security"],
    });
    if (!role.saved) throw new Error("role not saved");

    const piece = t.preparation.savePiece({
      kind: "achievement",
      belongsTo: role.piece.id,
      text: "Wrote the team's phishing runbook.",
      tags: ["incident response"],
      angles: ["security"],
    });

    expect(piece).toMatchObject({ saved: true, piece: { status: "confirmed", source: { from: "Added in Profile", quote: null } } });
    const list = t.preparation.listPieces();
    expect(list.groups.map((g) => ({ label: g.label, texts: g.pieces.map((p) => p.text || p.entry?.title) }))).toEqual([
      { label: "Security Analyst · Northwind Bank, Sofia · Mar 2022 – present", texts: ["Security Analyst", "Wrote the team's phishing runbook."] },
    ]);
  });
});

/** A piece drafted from a made-up CV, with the words it came from. */
const imported = { from: "mira-petrova-cv.pdf, page 1", quote: "Built 40 Splunk detections, reducing false positives by about a third." };

describe("the honesty checks on saving a piece", () => {
  it("refuses a number beyond its source, offering the source's own number as one-click fixes", () => {
    const t = createTestPreparation();
    const drafted = t.preparation.savePiece(
      { kind: "achievement", text: "Built 40 Splunk detections that cut false positives by about a third.", numberSource: "measured", angles: ["security"] },
      imported,
    );
    if (!drafted.saved) throw new Error("not saved");

    const edit = t.preparation.savePiece({ ...drafted.piece, text: "Built 40 Splunk detections that cut false positives by 50%." });

    expect(edit).toEqual({
      saved: false,
      problems: [{
        field: "text",
        message: "Your source says \"about a third\". 50% is more than favourable rounding, and an interviewer asking how you measured it would catch it.",
        fixes: [
          { label: "Use \"about a third\"", text: "Built 40 Splunk detections that cut false positives by about a third." },
          { label: "Use \"33%\"", text: "Built 40 Splunk detections that cut false positives by 33%." },
        ],
      }],
    });
    expect(t.preparation.listPieces().groups[0]!.pieces[0]!.text).toBe("Built 40 Splunk detections that cut false positives by about a third.");
  });

  it("won't save a piece with a number until it says where the number comes from", () => {
    const t = createTestPreparation();
    const input = { kind: "achievement" as const, text: "Triaged about 25 alerts a day in a 6-person SOC.", angles: ["security" as const] };

    const without = t.preparation.savePiece(input);
    const withSource = t.preparation.savePiece({ ...input, numberSource: "estimate" });

    expect(without).toEqual({
      saved: false,
      problems: [{ field: "numberSource", message: "This piece has a number, so pick where it comes from.", fixes: [] }],
    });
    expect(withSource).toMatchObject({ saved: true, piece: { numberSource: "estimate" } });
    expect(t.preparation.listPieces().total).toBe(1);
  });

  it.each([
    ["an achievement with no text", { kind: "achievement", text: "  " }, "text", "Say what you did, in one sentence."],
    ["a role with no title", { kind: "role", text: "", entry: { title: "", organisation: "Northwind Bank", city: null, start: "2022-03", end: null } }, "title", "Give the role's title."],
    ["a role with no employer", { kind: "role", text: "", entry: { title: "Analyst", organisation: "", city: null, start: "2022-03", end: null } }, "organisation", "Give the employer."],
    ["a role without its start month", { kind: "role", text: "", entry: { title: "Analyst", organisation: "Northwind Bank", city: null, start: "2022", end: null } }, "start", "Give the start as a month and year."],
    ["a role that ends before it starts", { kind: "role", text: "", entry: { title: "Analyst", organisation: "Northwind Bank", city: null, start: "2022-03", end: "2021-12" } }, "end", "The end can't be before the start."],
    ["an education with no school", { kind: "education", text: "", entry: { title: "BSc Computer Science", organisation: "", city: null, start: "2018-09", end: "2022-06" } }, "organisation", "Give the school."],
    ["a piece under a role that doesn't exist", { kind: "skill", text: "Python", belongsTo: "piece:gone" }, "belongsTo", "That role is no longer in your profile. Pick another, or none."],
  ] as const)("refuses %s", (_, input, field, message) => {
    const t = createTestPreparation();

    const saved = t.preparation.savePiece(input);

    expect(saved).toEqual({ saved: false, problems: [{ field, message, fixes: [] }] });
  });

  it("doesn't ask where a number comes from when the only numbers are years", () => {
    const t = createTestPreparation();

    const saved = t.preparation.savePiece({ kind: "achievement", text: "Moved the SOC's runbooks to the wiki in 2024.", numberSource: "measured" });

    expect(saved).toMatchObject({ saved: true, piece: { numberSource: null } });
  });
});
