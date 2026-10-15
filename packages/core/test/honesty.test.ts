import { describe, expect, it } from "vitest";
import { validateCv, type HonestyProfile, type ProfilePiece, type TailoredCv, type TailoredLine } from "../src/index.ts";

// The honesty validator (spec #51, ticket #63): every line the writer returns is held to the master
// profile, whatever the model says about its own claims. Tables of recorded-style outputs; made-up
// people and companies only.

const at = "2026-10-12T07:30:00.000Z";
function piece(p: Partial<ProfilePiece> & Pick<ProfilePiece, "id" | "kind">): ProfilePiece {
  return {
    text: "", entry: null, belongsTo: null, tags: [], angles: ["security"], numberSource: null, status: "confirmed",
    source: { from: "Added in Profile", quote: null }, alsoFrom: [], checkThis: false, dispute: null, createdAt: at, updatedAt: at, ...p,
  };
}

/** Mira Petrova's made-up profile: a current analyst role, an internship, results, skills. */
const pieces: ProfilePiece[] = [
  piece({ id: "analyst", kind: "role", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"] }),
  piece({ id: "intern", kind: "role", entry: { title: "SOC Intern", organisation: "Varna Telecom", city: "Varna", start: "2021-06", end: "2021-09" } }),
  piece({ id: "detections", kind: "achievement", belongsTo: "analyst", text: "Wrote 30 detection rules that cut false alerts by about a third.", tags: ["SIEM"], numberSource: "measured" }),
  piece({ id: "triage", kind: "achievement", belongsTo: "analyst", text: "Triaged about 20 alerts a day in Wazuh.", numberSource: "estimate" }),
  piece({ id: "told", kind: "achievement", belongsTo: "analyst", text: "Cut the phishing click rate to 4%.", numberSource: "told" }),
  piece({ id: "scripts", kind: "achievement", belongsTo: "intern", text: "Wrote Python scripts to enrich alerts with owner data." }),
  piece({ id: "wazuh", kind: "skill", text: "Wazuh", tags: ["SIEM"] }),
  piece({ id: "python", kind: "skill", text: "Python" }),
  piece({ id: "draft", kind: "skill", text: "Kubernetes", status: "unconfirmed" }),
];
const profile: HonestyProfile = { pieces, alsoNamed: ["Kestrel Payments"], now: new Date(at) };

const line = (text: string, pieceIds: string[], claim: TailoredLine["claim"] = "reworded"): TailoredLine => ({ text, pieceIds, claim, why: "" });
const analystRole = (bullets: TailoredLine[], facts: Partial<TailoredCv["roles"][number]> = {}): TailoredCv["roles"][number] => ({
  pieceId: "analyst", title: "Security Analyst", employer: "Northwind Bank", start: "2022-03", end: null, bullets, why: "", ...facts,
});
const output = (o: Partial<TailoredCv> = {}): TailoredCv => ({
  summary: line("Security analyst who writes detection rules.", ["detections"]),
  roles: [analystRole([line("Wrote 30 detection rules that cut false alerts by about a third", ["detections"], "as-written")])],
  skills: [{ text: "Wazuh", pieceIds: ["wazuh"] }],
  evidence: [],
  notes: [],
  ...o,
});

describe("roles: employers, titles and dates exactly as in the profile", () => {
  it("passes a role stated as the profile has it", () => {
    const v = validateCv(output(), profile);
    expect(v.roles.map((r) => r.pieceId)).toEqual(["analyst"]);
    expect(v.notes).toEqual([]);
    expect(v.caught).toEqual({ role: 0, skill: 0, number: 0, citation: 0 });
  });

  it.each([
    ["an invented employer", { pieceId: "role-x", employer: "Globex Security" }, "The draft listed a role at Globex Security, which isn't in your profile. It was left out."],
    ["a renamed employer", { employer: "Northwind Group" }, "The draft changed Security Analyst at Northwind Bank (employer). The CV keeps it exactly as in your profile."],
    ["a changed title", { title: "Senior Security Analyst" }, "The draft changed Security Analyst at Northwind Bank (title). The CV keeps it exactly as in your profile."],
    ["a changed start date", { start: "2021-03" }, "The draft changed Security Analyst at Northwind Bank (dates). The CV keeps it exactly as in your profile."],
    ["an ended current role", { end: "2026-09" }, "The draft changed Security Analyst at Northwind Bank (dates). The CV keeps it exactly as in your profile."],
  ] as [string, Partial<TailoredCv["roles"][number]>, string][])("never offers %s: the profile's facts stay, with a tailoring note", (_, facts, note) => {
    const v = validateCv(output({ roles: [analystRole([], facts)] }), profile);
    expect(v.notes).toEqual([note]);
    expect(v.caught.role).toBe(1);
    // A role kept is the profile's role (its facts come from the profile); an invented one is gone.
    expect(v.roles.map((r) => r.pieceId)).toEqual(facts.pieceId ? [] : ["analyst"]);
  });
});

/** The analyst role's bullets after validating these draft bullets. */
const bulletsOf = (bullets: TailoredLine[]) => validateCv(output({ roles: [analystRole(bullets)] }), profile);

describe("lines: every claim traces to the pieces it cites", () => {
  it("offers a reworded line that keeps to its piece", () => {
    const v = bulletsOf([{ ...line("Wrote 30 SIEM detection rules that cut false alerts by about a third", ["detections"]), why: "The posting's word for the same work." }]);
    expect(v.roles[0]!.bullets).toEqual([{
      text: "Wrote 30 SIEM detection rules that cut false alerts by about a third", pieceIds: ["detections"], why: "The posting's word for the same work.", kept: null,
    }]);
    expect(v.notes).toEqual([]);
  });

  it.each([
    // [what, draft line, rule, note]
    ["a number not in its piece", line("Wrote 45 detection rules that cut false alerts by about a third", ["detections"]), "number",
      "Kept your profile's wording for \"Wrote 30 detection rules that cut false alerts by about a…\": the draft says \"45\", which its piece doesn't back."],
    ["a rounder number than a measured source allows", line("Wrote 30 detection rules that cut false alerts by half", ["detections"]), "number",
      "Kept your profile's wording for \"Wrote 30 detection rules that cut false alerts by about a…\": the draft says \"half\", which its piece doesn't back."],
    ["any rounding of a number someone told Kris", line("Cut the phishing click rate to 5%", ["told"]), "number",
      "Kept your profile's wording for \"Cut the phishing click rate to 4%\": the draft says \"5%\", which its piece doesn't back."],
    ["a skill not in the profile", line("Wrote 30 detection rules in Splunk that cut false alerts by about a third", ["detections"]), "skill",
      "Kept your profile's wording for \"Wrote 30 detection rules that cut false alerts by about a…\": the draft names \"Splunk\", which isn't in your profile."],
    ["an employer not in the profile", line("Wrote 30 detection rules for Globex that cut false alerts by about a third", ["detections"]), "skill",
      "Kept your profile's wording for \"Wrote 30 detection rules that cut false alerts by about a…\": the draft names \"Globex\", which isn't in your profile."],
    ["a citation of a piece that isn't confirmed", line("Wrote 30 detection rules that cut false alerts by about a third", ["detections", "draft"]), "citation",
      "Kept your profile's wording for \"Wrote 30 detection rules that cut false alerts by about a…\": the draft cites a piece that isn't confirmed in your profile."],
  ])("never offers %s: it falls back to the piece's own wording", (_, draft, rule, note) => {
    const v = bulletsOf([draft]);
    expect(v.roles[0]!.bullets).toEqual([{
      text: "Wrote 30 detection rules that cut false alerts by about a third.".replace(/\.$/, ""), pieceIds: [draft.pieceIds[0]], why: "",
      kept: { reason: "failed", draft: draft.text, problems: [expect.objectContaining({ rule })] },
    }].map((b) => (draft.pieceIds[0] === "told" ? { ...b, text: "Cut the phishing click rate to 4%" } : b)));
    expect(v.caught[rule as keyof typeof v.caught]).toBe(1);
    expect(v.notes).toEqual([note]);
  });

  it.each([
    ["favourable rounding of a measured number", "Wrote 30 detection rules that cut false alerts by 35%", "detections"],
    ["an estimate kept as an estimate", "Triaged around 20 alerts a day in Wazuh", "triage"],
    ["the exact number someone told Kris", "Brought the phishing click rate down to 4%", "told"],
    ["the posting's company", "Wrote 30 detection rules like the ones Kestrel Payments asks for", "detections"],
    ["a tool named in another piece", "Wrote 30 detection rules in Wazuh", "detections"],
  ])("allows %s", (_, text, id) => {
    expect(bulletsOf([line(text, [id])]).roles[0]!.bullets[0]).toMatchObject({ text, kept: null });
  });

  it("leaves out a line that cites no piece of the profile, or a piece under another role", () => {
    const v = bulletsOf([line("Led a red team of 12", []), line("Wrote Python scripts to enrich alerts with owner data", ["scripts"])]);
    expect(v.roles[0]!.bullets).toEqual([]);
    expect(v.notes).toEqual([
      "Left out \"Led a red team of 12\": the draft cites no piece from your profile.",
      "Left out \"Wrote Python scripts to enrich alerts with owner data\": the draft puts it under a role it isn't from.",
    ]);
    expect(v.caught).toMatchObject({ citation: 1, role: 1 });
  });

  it("holds back a stronger wording for Kris's decision, using the piece's own words", () => {
    const v = bulletsOf([line("Led detection engineering: 30 rules that cut false alerts by about a third", ["detections"], "stronger")]);
    expect(v.roles[0]!.bullets[0]).toEqual({
      text: "Wrote 30 detection rules that cut false alerts by about a third", pieceIds: ["detections"], why: "",
      kept: { reason: "near-the-line", draft: "Led detection engineering: 30 rules that cut false alerts by about a third", problems: [] },
    });
    expect(v.heldBack).toBe(1);
    expect(v.notes).toEqual(["Held back a stronger wording for \"Wrote 30 detection rules that cut false alerts by about a…\": your profile's words are used until you decide."]);
  });
});

describe("the summary", () => {
  it("allows years of experience up to what the role dates add up to", () => {
    const ok = validateCv(output({ summary: line("Security analyst with 4 years in security operations.", ["analyst", "intern"]) }), profile);
    expect(ok.summary).toMatchObject({ text: "Security analyst with 4 years in security operations.", kept: null });
    const over = validateCv(output({ summary: line("Security analyst with 6+ years in security operations.", ["analyst"]) }), profile);
    expect(over.summary).toBeNull();
    expect(over.notes).toEqual(["Kept your angle's summary: the draft says \"6+ years\", which its piece doesn't back."]);
  });
});

describe("skills and evidence", () => {
  it("lists only skills that are skill pieces of the profile, in the draft's order", () => {
    const v = validateCv(output({
      skills: [{ text: "Python", pieceIds: ["python"] }, { text: "Splunk", pieceIds: [] }, { text: "Wazuh", pieceIds: ["python"] }, { text: "Kubernetes", pieceIds: ["draft"] }],
    }), profile);
    expect(v.skills).toEqual(["python", "wazuh"]);
    expect(v.caught.skill).toBe(2);
    expect(v.notes).toEqual([
      "Left \"Splunk\" off the skills: it isn't a skill in your profile.",
      "Left \"Kubernetes\" off the skills: it isn't a skill in your profile.",
    ]);
  });

  it("keeps only the confirmed pieces the draft cites as evidence", () => {
    const v = validateCv(output({ evidence: [{ requirement: 0, pieceIds: ["detections", "draft", "nope"] }, { requirement: 1, pieceIds: ["draft"] }] }), profile);
    expect(v.evidence).toEqual([{ requirement: 0, pieceIds: ["detections"] }]);
  });

  it("uses an unconfirmed piece learned in this package", () => {
    const v = validateCv(output({ skills: [{ text: "Kubernetes", pieceIds: ["draft"] }] }), { ...profile, packagePieces: ["draft"] });
    expect(v.skills).toEqual(["draft"]);
  });
});
