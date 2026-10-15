import { describe, expect, it } from "vitest";
import { createTestPreparation, memoryFileStore } from "./preparation-harness.ts";

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

/** Mira Petrova's made-up profile: two roles, a degree, and pieces under them and under none. */
function miraProfile() {
  const t = createTestPreparation();
  const save = (input: Parameters<typeof t.preparation.savePiece>[0]) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(r.problems[0]!.message);
    return r.piece.id;
  };
  const intern = save({ kind: "role", text: "", entry: { title: "SOC Intern", organisation: "Varna Telecom", city: "Varna", start: "2021-06", end: "2021-08" }, angles: ["security"] });
  const degree = save({ kind: "education", text: "", entry: { title: "BSc Computer Science", organisation: "Danube Institute of Technology", city: null, start: "2017-09", end: "2021-06" } });
  const analyst = save({ kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, angles: ["security"] });
  save({ kind: "skill", text: "Splunk", belongsTo: analyst, tags: ["SIEM"], angles: ["security"] });
  save({ kind: "achievement", text: "Wrote the phishing runbook the SOC still uses.", belongsTo: analyst, tags: ["incident response"], angles: ["security"] });
  save({ kind: "achievement", text: "Built a booking site in React for a dental clinic.", tags: ["React"], angles: ["developer", "design"] });
  save({ kind: "skill", text: "Български (роден)", tags: ["езици"] });
  save({ kind: "achievement", text: "Mapped the office network for an audit.", belongsTo: intern, angles: ["security"] });
  void degree;
  return t;
}

const summarise = (list: ReturnType<ReturnType<typeof createTestPreparation>["preparation"]["listPieces"]>) =>
  list.groups.map((g) => [g.label, g.pieces.map((p) => p.text || p.kind)]);

describe("browsing the master profile", () => {
  it("groups pieces by role, newest role first, then education, then pieces tied to no role", () => {
    const t = miraProfile();

    expect(summarise(t.preparation.listPieces())).toEqual([
      ["Security Analyst · Northwind Bank, Sofia · Mar 2022 – present", ["role", "Wrote the phishing runbook the SOC still uses.", "Splunk"]],
      ["SOC Intern · Varna Telecom, Varna · Jun 2021 – Aug 2021", ["role", "Mapped the office network for an audit."]],
      ["BSc Computer Science · Danube Institute of Technology · Sep 2017 – Jun 2021", ["education"]],
      ["Skills and languages not tied to a role", ["Built a booking site in React for a dental clinic.", "Български (роден)"]],
    ]);
  });

  it("filters by type and angle, and counts each type for the filter", () => {
    const t = miraProfile();

    const list = t.preparation.listPieces({ kind: "achievement", angle: "security" });

    expect(summarise(list)).toEqual([
      ["Security Analyst · Northwind Bank, Sofia · Mar 2022 – present", ["Wrote the phishing runbook the SOC still uses."]],
      ["SOC Intern · Varna Telecom, Varna · Jun 2021 – Aug 2021", ["Mapped the office network for an audit."]],
    ]);
    expect(list.byKind).toEqual({ role: 2, achievement: 2, skill: 1, education: 0 });
    expect({ total: list.total, confirmed: list.confirmed }).toEqual({ total: 8, confirmed: 8 });
  });

  it.each([
    ["splunk", ["Splunk"]],
    ["siem", ["Splunk"]],
    ["northwind", ["role"]],
    ["БЪЛГАРСКИ", ["Български (роден)"]],
  ])("finds %s in text, tags and a role's facts, ignoring case", (search, texts) => {
    const t = miraProfile();

    expect(summarise(t.preparation.listPieces({ search })).flatMap(([, ts]) => ts)).toEqual(texts);
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
    expect(t.preparation.piece(drafted.piece.id)).toMatchObject({ text: "Built 40 Splunk detections that cut false positives by about a third.", source: imported });
  });

  it("reads numbers written as words in the source", () => {
    const t = createTestPreparation();
    const coach = { from: "Coach interview", quote: "I led one phishing incident and helped with two more" };

    const digits = t.preparation.savePiece({ kind: "achievement", text: "Led the response to 1 phishing incident and supported 2 more.", numberSource: "measured" }, coach);
    const inflated = t.preparation.savePiece({ kind: "achievement", text: "Led the response to three phishing incidents.", numberSource: "measured" }, coach);

    expect(digits.saved).toBe(true);
    expect(inflated).toMatchObject({ saved: false, problems: [{ field: "text", message: expect.stringContaining("three") }] });
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
    ["an achievement longer than one sentence of 200 characters", { kind: "achievement", text: "Ran the SOC's weekly review. ".repeat(7) }, "text", "Keep it to one sentence of 200 characters or fewer; split a longer story into pieces."],
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

describe("deleting a piece", () => {
  it("removes it, and the pieces under a deleted role stay as pieces tied to no role", () => {
    const t = createTestPreparation();
    const role = t.preparation.savePiece({ kind: "role", text: "", entry: { title: "SOC Intern", organisation: "Varna Telecom", city: null, start: "2021-06", end: "2021-08" } });
    if (!role.saved) throw new Error("not saved");
    const skill = t.preparation.savePiece({ kind: "skill", text: "Wireshark", belongsTo: role.piece.id });
    const gone = t.preparation.savePiece({ kind: "skill", text: "Nmap", belongsTo: role.piece.id });
    if (!skill.saved || !gone.saved) throw new Error("not saved");

    expect(t.preparation.deletePiece(gone.piece.id)).toEqual({ deleted: true, untied: 0 });
    expect(t.preparation.deletePiece(role.piece.id)).toEqual({ deleted: true, untied: 1 });
    expect(t.preparation.deletePiece(role.piece.id)).toEqual({ deleted: false, untied: 0 });

    expect(t.preparation.listPieces().groups).toEqual([
      { id: "none", label: "Skills and languages not tied to a role", pieces: [expect.objectContaining({ text: "Wireshark", belongsTo: null })] },
    ]);
  });

  // Packages arrive with a later ticket; then this asserts that an approved package's files keep their SHA-256.
  it.todo("never changes a frozen package file when a piece it used is edited or deleted");
});

describe("what Profile needs from Kris", () => {
  it("counts unconfirmed and flagged pieces per section, adding up to the nav badge", () => {
    const t = createTestPreparation();
    t.preparation.savePiece({ kind: "skill", text: "Python" });
    t.preparation.savePiece({ kind: "achievement", text: "Traced a card-testing pattern with the fraud team." }, { from: "Kestrel Payments package", quote: "once, card testing, we built a detection", status: "unconfirmed" });
    t.preparation.savePiece({ kind: "skill", text: "Kubernetes" }, { from: "Halden Systems package", quote: "played with k3s once", status: "flagged" });

    expect(t.preparation.profileSummary()).toEqual({
      pieces: 3,
      confirmed: 1,
      needsYou: { masterProfile: 2, angles: 0, answerBank: 0, voice: 0 },
      needsYouTotal: 2,
      // Pieces saved with a package's name aren't learned during packages: only a gap answer makes one.
      learned: 0,
    });
  });

  it("is empty before anything is added", () => {
    const t = createTestPreparation();

    expect(t.preparation.profileSummary()).toEqual({
      pieces: 0, confirmed: 0, needsYou: { masterProfile: 0, angles: 0, answerBank: 0, voice: 0 }, needsYouTotal: 0, learned: 0,
    });
  });
});

const mira = {
  nameLatin: "Mira Petrova",
  nameCyrillic: "Мира Петрова",
  email: "mira.jobs@example.com",
  phone: "+359 88 000 0199",
  city: "Sofia",
  country: "Bulgaria",
  links: ["https://www.linkedin.com/in/mira-petrova-example", "https://github.com/mira-petrova-example"],
};
/** A tiny PNG's first bytes: enough to be read as a PNG. */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("contact details and links", () => {
  it("starts empty, then keeps what Kris saves", () => {
    const t = createTestPreparation();
    expect(t.preparation.contact()).toEqual({
      nameLatin: "", nameCyrillic: "", email: "", phone: "", city: "", country: "", links: [], photo: null,
    });

    const saved = t.preparation.saveContact({ ...mira, links: [...mira.links, "  ", mira.links[0]!] });

    expect(saved).toEqual({ saved: true, contact: { ...mira, photo: null } });
    expect(t.preparation.contact()).toEqual({ ...mira, photo: null });
  });

  it.each([
    ["no Latin name", { nameLatin: " " }, "nameLatin", "Give your name in Latin script, as on your CV."],
    ["a Latin name in Cyrillic", { nameLatin: "Мира Петрова" }, "nameLatin", "Use Latin letters here; your name in Cyrillic has its own field."],
    ["an email that isn't one", { email: "mira.jobs" }, "email", "Give an email address like name@example.com."],
    ["a link that isn't a web address", { links: ["mira-petrova"] }, "links", "\"mira-petrova\" isn't a web address. Start links with https://."],
  ] as const)("refuses %s", (_, patch, field, message) => {
    const t = createTestPreparation();

    expect(t.preparation.saveContact({ ...mira, ...patch, links: [...("links" in patch ? patch.links : mira.links)] })).toEqual({ saved: false, problems: [{ field, message }] });
    expect(t.preparation.contact().nameLatin).toBe("");
  });

  it("reads a link without https:// as a web address", () => {
    const t = createTestPreparation();

    const saved = t.preparation.saveContact({ ...mira, links: ["github.com/mira-petrova-example"] });

    expect(saved).toMatchObject({ saved: true, contact: { links: ["https://github.com/mira-petrova-example"] } });
  });

  it("keeps an optional photo in the file store, replacing or removing the copy", async () => {
    const t = createTestPreparation();
    t.preparation.saveContact(mira);

    const first = await t.preparation.setPhoto({ fileName: "mira.png", bytes: png });
    const second = await t.preparation.setPhoto({ fileName: "mira-2024.png", bytes: new Uint8Array([...png, 4]) });
    const stored = [...(t.files as ReturnType<typeof memoryFileStore>).files.keys()];
    const removed = await t.preparation.removePhoto();

    expect(first).toMatchObject({ saved: true, contact: { photo: { fileName: "mira.png", size: 11 } } });
    expect(second).toMatchObject({ saved: true, contact: { nameLatin: "Mira Petrova", photo: { fileName: "mira-2024.png", size: 12 } } });
    expect(stored).toEqual([second.saved && second.contact.photo!.sha256]);
    expect(removed.photo).toBeNull();
    expect((t.files as ReturnType<typeof memoryFileStore>).files.size).toBe(0);
  });

  it("refuses a photo that isn't a JPEG or PNG", async () => {
    const t = createTestPreparation();

    const result = await t.preparation.setPhoto({ fileName: "mira.heic", bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) });

    expect(result).toEqual({ saved: false, problems: [{ field: "photo", message: "Use a JPEG or PNG photo. On a Mac, Preview can export one." }] });
    expect(t.preparation.contact().photo).toBeNull();
  });
});

describe("exporting the profile", () => {
  it("returns every piece with its source, the contact details with the photo, and the list of sources", async () => {
    const t = createTestPreparation();
    t.preparation.saveContact(mira);
    await t.preparation.setPhoto({ fileName: "mira.png", bytes: png });
    t.preparation.savePiece({ kind: "skill", text: "Python" });
    t.preparation.savePiece({ kind: "achievement", text: "Built 40 Splunk detections that cut false positives by about a third.", numberSource: "measured" }, imported);
    t.preparation.savePiece({ kind: "skill", text: "Kubernetes" }, { from: "Halden Systems package", quote: "played with k3s once", status: "flagged" });

    const exported = await t.preparation.exportProfile();

    expect(exported).toEqual({
      format: "apply-kit master profile",
      version: 1,
      exportedAt: "2026-10-12T07:30:00.000Z",
      contact: { ...mira, photo: { fileName: "mira.png", sha256: expect.any(String), size: 11, base64: Buffer.from(png).toString("base64") } },
      pieces: [
        expect.objectContaining({ text: "Python", status: "confirmed", source: { from: "Added in Profile", quote: null } }),
        expect.objectContaining({ text: "Built 40 Splunk detections that cut false positives by about a third.", numberSource: "measured", source: imported }),
        expect.objectContaining({ text: "Kubernetes", status: "flagged", source: { from: "Halden Systems package", quote: "played with k3s once" } }),
      ],
      sources: [
        { from: "Added in Profile", pieces: 1 },
        { from: "mira-petrova-cv.pdf, page 1", pieces: 1 },
        { from: "Halden Systems package", pieces: 1 },
      ],
    });
  });
});
