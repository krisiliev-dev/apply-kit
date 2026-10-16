import { describe, expect, it } from "vitest";
import { createTestPreparation, fakeWriter } from "./preparation-harness.ts";

function stand() {
  let groups: { ids: string[]; reason: string }[] = [];
  const t = createTestPreparation({ consolidator: { estimateUsd: () => 0.01, propose: async () => ({ groups, costUsd: 0.001 }) } });
  const add = (kind: "role" | "achievement" | "skill", text: string, extra = {}) => {
    const r = t.preparation.savePiece({ kind, text, ...extra }, { from: `CV-${text || "role"}.pdf`, quote: text || "Analyst at Kestrel", status: "unconfirmed" });
    if (!r.saved) throw new Error(JSON.stringify(r.problems));
    return r.piece.id;
  };
  const role = (end: string | null = null) => add("role", "", { entry: { title: "Security Analyst", organisation: "Kestrel Ltd", city: "Sofia", start: "2020-03", end } });
  return { ...t, add, role, suggest: (g: typeof groups) => { groups = g; } };
}

describe("profile consolidation", () => {
  it("previews semantic matches without changing pieces, then merges roles and their facts with sources and undo", async () => {
    const t = stand(); const a = t.role(), b = t.role("2024-06");
    const x = t.add("achievement", "Handled incident response", { belongsTo: a });
    const y = t.add("achievement", "Coordinated security incident handling", { belongsTo: b });
    t.suggest([{ ids: [a, b], reason: "Same employment, updated end date" }, { ids: [x, y], reason: "Same responsibility" }]);
    const before = t.preparation.listPieces();
    const preview = await t.preparation.previewConsolidation();
    expect(preview).toMatchObject({ before: 4, after: 2, status: "preview" });
    expect(t.preparation.listPieces()).toEqual(before);
    const applied = t.preparation.applyConsolidation(preview.id, preview.groups.map(g => g.id));
    expect(applied.status).toBe("applied");
    const pieces = t.preparation.listPieces().groups.flatMap(g => g.pieces);
    expect(pieces).toHaveLength(2);
    expect(pieces.find(p => p.kind === "role")?.entry?.end).toBe("2024-06");
    expect(pieces.find(p => p.kind === "achievement")?.belongsTo).toBe(pieces.find(p => p.kind === "role")!.id);
    expect(pieces.find(p => p.kind === "achievement")?.alsoFrom).toHaveLength(1);
    t.preparation.undoConsolidation(preview.id);
    expect(t.preparation.listPieces()).toEqual(before);
  });

  it("keeps different numbers and distinct employment periods out of the merge", async () => {
    const t = stand(); const a = t.add("achievement", "Cut alerts by 20 percent"), b = t.add("achievement", "Reduced alerts by 30 percent");
    const r = t.role(), s = t.add("role", "", { entry: { title: "Security Analyst", organisation: "Kestrel Ltd", start: "2015-01", end: "2018-01", city: "Sofia" } });
    t.suggest([{ ids: [a, b], reason: "Similar wording" }, { ids: [r, s], reason: "Same employer" }]);
    const p = await t.preparation.previewConsolidation();
    expect(p.after).toBe(4);
    expect(p.groups.every(g => !!g.blockedReason)).toBe(true);
    expect(() => t.preparation.applyConsolidation(p.id, p.groups.map(g => g.id))).toThrow();
  });

  it("requires the matching role merge before consolidating facts across those roles", async () => {
    const t = stand(); const a = t.role(), b = t.role();
    const x = t.add("skill", "Python", { belongsTo: a }), y = t.add("skill", "Python", { belongsTo: b });
    t.suggest([{ ids: [a, b], reason: "Same role" }, { ids: [x, y], reason: "Same skill" }]);
    const p = await t.preparation.previewConsolidation();
    expect(() => t.preparation.applyConsolidation(p.id, [p.groups[1]!.id])).toThrow(/role/i);
    expect(t.preparation.listPieces().total).toBe(4);
  });

  it("preserves a confirmed keeper and refuses to hide two confirmed decisions", async () => {
    const t = stand(); const a = t.add("skill", "Python"), b = t.add("skill", "Python programming");
    t.preparation.confirmPiece(a);
    t.suggest([{ ids: [a, b], reason: "Same skill" }]);
    const p = await t.preparation.previewConsolidation();
    expect(p.groups[0]!.keep.id).toBe(a);
    t.preparation.confirmPiece(b);
    expect(() => t.preparation.applyConsolidation(p.id, [p.groups[0]!.id])).toThrow(/changed/i);
    const q = await t.preparation.previewConsolidation();
    expect(q.after).toBe(2);
    expect(q.groups[0]!.blockedReason).toMatch(/confirmed/i);
  });

  it("does not merge similar facts from unrelated roles or changed ownership", async () => {
    const t = stand(); const a = t.role(), b = t.role();
    const x = t.add("achievement", "Managed incident response", { belongsTo: a }), y = t.add("achievement", "Supported incident response", { belongsTo: b });
    t.suggest([{ ids: [x, y], reason: "Same topic" }]);
    const p = await t.preparation.previewConsolidation();
    expect(p.after).toBe(4);
    expect(p.groups[0]!.blockedReason).toBeTruthy();
  });

  it("keeps unique role descriptions and user classifications separate", async () => {
    const t = stand(); const a = t.role();
    const b = t.add("role", "Ran the night-shift SOC", { entry: { title: "Security Analyst", organisation: "Kestrel Ltd", city: "Sofia", start: "2020-03", end: null } });
    const x = t.add("skill", "Python", { tags: ["automation"] }), y = t.add("skill", "Python programming", { tags: ["development"] });
    t.suggest([{ ids: [a, b], reason: "Same role" }, { ids: [x, y], reason: "Same skill" }]);
    const p = await t.preparation.previewConsolidation();
    expect(p.after).toBe(4);
    expect(p.groups.every(g => g.blockedReason)).toBe(true);
  });

  it("keeps merged versions out of discarded review and permits repeated apply and undo without changing counts", async () => {
    const t = stand(); const a = t.add("skill", "Python"), b = t.add("skill", "Python programming");
    t.suggest([{ ids: [a, b], reason: "Same skill" }]);
    const p = await t.preparation.previewConsolidation();
    t.preparation.applyConsolidation(p.id, [p.groups[0]!.id]);
    t.preparation.applyConsolidation(p.id, [p.groups[0]!.id]);
    expect(t.preparation.listPieces().total).toBe(1);
    expect(t.preparation.draftsToCheck("discarded").groups).toHaveLength(0);
    t.preparation.undoConsolidation(p.id);
    t.preparation.undoConsolidation(p.id);
    expect(t.preparation.listPieces().total).toBe(2);
  });

  it("blocks differences in numeric precision and hedge direction", async () => {
    const t = stand();
    const pairs = [["Cut alerts by up to 30 percent", "Cut alerts by over 30 percent"], ["Cut alerts by 20 percent", "Cut alerts by 20.04 percent"]];
    t.suggest(pairs.map(pair => ({ ids: pair.map(text => t.add("achievement", text)), reason: "Similar claim" })));
    const p = await t.preparation.previewConsolidation();
    expect(p.after).toBe(4);
  });

  it("attaches later imported facts to the surviving role", async () => {
    const ids: string[] = [];
    const entry = { title: "Security Analyst", organisation: "Kestrel Ltd", city: "Sofia", start: "2020-03", end: null };
    const t = createTestPreparation({
      consolidator: { estimateUsd: () => 0, propose: async () => ({ costUsd: 0, groups: [{ ids, reason: "Same role" }] }) },
      writer: fakeWriter({ draftPieces: { pieces: [
        { kind: "role", text: "", entry, role: null, quote: "Security Analyst at Kestrel" },
        { kind: "achievement", text: "Wrote the response playbook", entry: null, role: 0, quote: "Wrote the response playbook" },
      ] } }),
    });
    for (const end of [null, "2024-06"]) {
      const saved = t.preparation.savePiece({ kind: "role", text: "", entry: { ...entry, end } }, { from: "CV.pdf", quote: "Security Analyst at Kestrel", status: "unconfirmed" });
      if (!saved.saved) throw new Error("Fixture role rejected");
      ids.push(saved.piece.id);
    }
    const p = await t.preparation.previewConsolidation();
    t.preparation.applyConsolidation(p.id, [p.groups[0]!.id]);
    const run = await t.preparation.startImport({ files: [{ fileName: "new.txt", bytes: new TextEncoder().encode("Security Analyst at Kestrel. Wrote the response playbook") }] });
    if (!run.started) throw new Error("Fixture import rejected");
    await run.done;
    const pieces = t.preparation.listPieces().groups.flatMap(g => g.pieces);
    expect(pieces.find(piece => piece.kind === "achievement")?.belongsTo).toBe(p.groups[0]!.keep.id);
  });

  it("preserves precise dates and locations when reconciling roles", async () => {
    const t = stand();
    const a = t.add("role", "", { entry: { title: "Security Analyst", organisation: "Kestrel Ltd", city: null, start: "2020", end: null } });
    const b = t.role();
    t.suggest([{ ids: [a, b], reason: "Same employment" }]);
    const p = await t.preparation.previewConsolidation();
    expect(p.groups[0]!.keep.id).toBe(b);
  });

  it("rejects unknown IDs, ignores repeated suggestions and prevents stale undo from overwriting edits", async () => {
    const t = stand(); const a = t.add("skill", "Python"), b = t.add("skill", "Python programming");
    t.suggest([{ ids: [a, "invented"], reason: "Match" }]);
    await expect(t.preparation.previewConsolidation()).rejects.toThrow(/unknown/i);
    t.suggest([{ ids: [a, b], reason: "Match" }, { ids: [a, b], reason: "Again" }]);
    expect((await t.preparation.previewConsolidation()).groups).toHaveLength(1);
    t.suggest([{ ids: [a, b], reason: "Match" }]);
    const p = await t.preparation.previewConsolidation();
    t.preparation.applyConsolidation(p.id, [p.groups[0]!.id]);
    const keeper = p.groups[0]!.keep;
    t.preparation.savePiece({ ...keeper, text: "Python for automation" });
    expect(() => t.preparation.undoConsolidation(p.id)).toThrow(/changed/i);
    expect(t.preparation.piece(keeper.id)?.text).toBe("Python for automation");
  });
});
