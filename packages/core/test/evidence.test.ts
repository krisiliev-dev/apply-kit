import { describe, expect, it } from "vitest";
import { matchEvidence, type ProfilePiece, type RequirementToMatch } from "../src/index.ts";

// The evidence matcher (ticket #60), tested directly with tables of cases. Made-up person only:
// Mira Petrova, with fictional employers.

const now = new Date("2026-10-12T07:30:00Z");

let next = 0;
function piece(p: Partial<ProfilePiece> & Pick<ProfilePiece, "kind">): ProfilePiece {
  return {
    id: `piece:${++next}`, text: "", entry: null, belongsTo: null, tags: [], angles: [], numberSource: null,
    status: "confirmed", source: { from: "Added in Profile", quote: null }, alsoFrom: [], checkThis: false, dispute: null, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    ...p,
  };
}
const role = (title: string, organisation: string, start: string, end: string | null, extra: Partial<ProfilePiece> = {}) =>
  piece({ kind: "role", entry: { title, organisation, city: null, start, end }, ...extra });

const analyst = role("Junior Security Analyst", "Orbital Bank", "2023-07", null, { id: "piece:analyst", angles: ["security"] });
const intern = role("SOC Intern", "Varna Telecom", "2022-06", "2022-09", { id: "piece:intern", angles: ["security"] });
const webdev = role("Web Developer", "Pixel Studio", "2019-01", "2021-12", { id: "piece:webdev", angles: ["developer"] });
const mira: ProfilePiece[] = [
  analyst, intern, webdev,
  piece({ id: "piece:splunk", kind: "achievement", belongsTo: analyst.id, text: "Built 40 Splunk detections, false positives down by about a third.", tags: ["Splunk", "SIEM"], angles: ["security"] }),
  piece({ id: "piece:phishing", kind: "achievement", belongsTo: analyst.id, text: "Part of the response to 3 phishing incidents.", angles: ["security"] }),
  piece({ id: "piece:english", kind: "skill", text: "English (C1)" }),
  piece({ id: "piece:bulgarian", kind: "skill", text: "Български (роден)" }),
  piece({ id: "piece:react", kind: "skill", text: "React", tags: ["JavaScript"], angles: ["developer"] }),
  piece({ id: "piece:secplus", kind: "education", text: "CompTIA Security+", entry: null }),
  piece({ id: "piece:k8s-draft", kind: "skill", text: "Kubernetes", status: "unconfirmed" }),
];

const req = (text: string, category: RequirementToMatch["category"], kind: RequirementToMatch["kind"] = "required"): RequirementToMatch => ({ text, kind, category });

describe("the evidence matcher: years from role dates", () => {
  it.each([
    ["3+ years in security operations", "met", ["piece:analyst", "piece:intern"]],
    ["5+ years in security operations", "partly", ["piece:analyst", "piece:intern"]],
    ["2+ years of web development experience", "met", ["piece:webdev"]],
    ["3 years of experience in hardware design", "gap", []],
  ] as const)("%s → %s", (text, status, pieces) => {
    const e = matchEvidence(req(text, "experience"), mira, now);
    expect(e.status).toBe(status);
    expect(e.pieces.map((p) => p.id)).toEqual(pieces);
  });
});

describe("the evidence matcher: skills by whole words, tags and synonyms", () => {
  it.each([
    ["Kubernetes", "required", "gap", []],
    ["Kubernetes security", "required", "gap", []],
    ["SIEM: Splunk or Elastic", "required", "met", ["piece:splunk"]],
    ["Incident response", "required", "met", ["piece:phishing"]],
    ["JavaScript", "required", "met", ["piece:react"]],
    ["React and Vue", "required", "partly", ["piece:react"]],
    ["Java", "required", "gap", []],
    ["Splunk", "preferred", "met", ["piece:splunk"]],
    ["Terraform", "preferred", "not-held", []],
  ] as const)("%s (%s) → %s", (text, kind, status, pieces) => {
    const e = matchEvidence(req(text, "skill", kind), mira, now);
    expect(e.status).toBe(status);
    expect(e.pieces.map((p) => p.id)).toEqual(pieces);
  });

  it("counts only confirmed pieces: an unconfirmed Kubernetes piece is no evidence", () => {
    expect(matchEvidence(req("Kubernetes", "skill"), mira, now).status).toBe("gap");
  });

  it("names the gap plainly", () => {
    expect(matchEvidence(req("Kubernetes", "skill"), mira, now).note).toBe("No evidence in your master profile");
  });

  it("matches Cyrillic requirements through the synonym table", () => {
    const e = matchEvidence(req("Реакция при инциденти", "skill"), mira, now);
    expect(e.status).toBe("met");
  });
});

describe("the evidence matcher: languages and levels", () => {
  it.each([
    ["English, professional", "required", "met", ["piece:english"]],
    ["English, C2", "required", "partly", ["piece:english"]],
    ["Bulgarian, fluent", "required", "met", ["piece:bulgarian"]],
    ["Английски", "required", "met", ["piece:english"]],
    ["German, B1", "required", "gap", []],
    ["German", "preferred", "not-held", []],
  ] as const)("%s (%s) → %s", (text, kind, status, pieces) => {
    const e = matchEvidence(req(text, "language", kind), mira, now);
    expect(e.status).toBe(status);
    expect(e.pieces.map((p) => p.id)).toEqual(pieces);
  });

  it("says when the profile states a lower level than asked", () => {
    expect(matchEvidence(req("English, C2", "language"), mira, now).note).toBe("Your profile says C1; C2 asked");
  });
});

describe("the evidence matcher: certificates", () => {
  it.each([
    ["CompTIA Security+", "required", "met", ["piece:secplus"]],
    ["CISSP", "preferred", "not-held", []],
    ["CISSP", "required", "gap", []],
    ["CompTIA Network+", "required", "gap", []],
  ] as const)("%s (%s) → %s", (text, kind, status, pieces) => {
    const e = matchEvidence(req(text, "certificate", kind), mira, now);
    expect(e.status).toBe(status);
    expect(e.pieces.map((p) => p.id)).toEqual(pieces);
  });

  it("says a preferred certificate not held is left out, not claimed, and never a gap", () => {
    expect(matchEvidence(req("CISSP", "certificate", "preferred"), mira, now).note).toBe("Not held: left out, not claimed. Preferred items never count as gaps");
  });
});

describe("the evidence matcher: what the profile can't tell", () => {
  it.each([
    ["Based in Sofia", "location"],
    ["Right to work in the EU", "work-authorisation"],
  ] as const)("leaves %s (%s) unknown: the dealbreakers check it", (text, category) => {
    expect(matchEvidence(req(text, category), mira, now)).toMatchObject({ status: "unknown", pieces: [] });
  });
});
