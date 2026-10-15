// A made-up master profile and job for package tests that go all the way to approval (#67):
// Mira Petrova's profile and answer bank, Kestrel Payments' recorded Greenhouse form, and a CV that
// reads back like the real template. Made-up people, companies and postings only.
import type { PackageJob, PieceInput } from "../src/index.ts";
import { fixtureFetch } from "./harness.ts";
import { createTestPreparation, fakeWriter, recordedDraftAnswer, recordedLetter, recordedTailoredCv, recordedWhyAnswer, templateRenderer } from "./preparation-harness.ts";

const kestrelQuestions = "https://boards-api.greenhouse.io/v1/boards/kestrel/jobs/4410?questions=true";

/** A recorded output with its placeholder ids ("piece-phishing") swapped for the profile's. */
const withIds = <T>(recorded: T, ids: Record<string, string>): T =>
  JSON.parse(JSON.stringify(recorded).replace(/"piece-([a-z]+)"/g, (m, key: string) => (ids[key] ? JSON.stringify(ids[key]) : m))) as T;

type Options = Parameters<typeof createTestPreparation>[0] & { phone?: string };

/** Mira Petrova's made-up master profile and answer bank, with Kestrel's recorded form and a CV that reads like the real template. */
export function mira({ phone = "+359 88 000 0175", ...options }: Options = {}) {
  const ids: Record<string, string> = {};
  const writer = fakeWriter({
    tailorCv: () => withIds(recordedTailoredCv, ids),
    writeLetter: () => withIds(recordedLetter, ids),
    draftAnswer: (input) => withIds(/^why/i.test(input.question) ? recordedWhyAnswer : recordedDraftAnswer, ids),
  });
  const t = createTestPreparation({ writer, renderer: templateRenderer(), fetch: fixtureFetch({ [kestrelQuestions]: "greenhouse-kestrel-4410-questions.json" }), ...options });
  const save = (key: string, input: PieceInput) => {
    const r = t.preparation.savePiece(input);
    if (!r.saved) throw new Error(`${key}: ${r.problems[0]!.message}`);
    ids[key] = r.piece.id;
  };
  save("analyst", { kind: "role", text: "", entry: { title: "Security Analyst", organisation: "Northwind Bank", city: "Sofia", start: "2022-03", end: null }, tags: ["SOC"], angles: ["security"] });
  save("detections", { kind: "achievement", text: "Wrote 30 detection rules that cut false alerts by a quarter.", belongsTo: ids.analyst, tags: ["SIEM"], angles: ["security"], numberSource: "measured" });
  save("phishing", { kind: "achievement", text: "Ran the response to a phishing campaign against the claims team.", belongsTo: ids.analyst, tags: ["incident response"], angles: ["security"] });
  save("wazuh", { kind: "skill", text: "Wazuh", tags: ["SIEM"], angles: ["security"] });
  save("degree", { kind: "education", text: "", entry: { title: "BSc Computer Science", organisation: "Danube Institute of Technology", city: "Ruse", start: "2018-09", end: "2022-06" }, angles: ["security", "developer"] });
  t.preparation.saveAngle({ angle: "security", summary: "Security analyst at a bank, writing detection rules." });
  t.preparation.saveContact({
    nameLatin: "Mira Petrova", nameCyrillic: "Мира Петрова", email: "mira.petrova@example.com", phone, city: "Sofia", country: "Bulgaria",
    links: ["https://www.linkedin.com/in/mira-petrova-example"],
  });
  const bank = (input: Parameters<typeof t.preparation.saveAnswer>[0]) => {
    const r = t.preparation.saveAnswer(input);
    if (!r.saved) throw new Error(r.problems[0]!.message);
  };
  bank({ question: "Right to work in Bulgaria", wordings: ["Do you have the right to work in Bulgaria?"], versions: { en: "Yes", bg: "Да" }, category: "standard", kind: "yes-no" });
  bank({ question: "Notice period", wordings: ["What is your notice period?"], versions: { en: "1 month", bg: "1 месец" }, category: "standard" });
  return { ...t, ids };
}

/** A made-up Kestrel Payments job: its Greenhouse page (the target), asking for Wazuh and Kubernetes. */
export function kestrelJob(overrides: Partial<PackageJob> = {}): PackageJob {
  return {
    id: "job-kestrel",
    title: "Security Engineer",
    titleTranslation: null,
    company: "Kestrel Payments",
    location: "Sofia",
    packageLanguage: "en",
    closed: null,
    reading: { state: "read" },
    requirements: [{ text: "Experience triaging alerts in a SIEM" }, { text: "Incident response" }, { text: "Wazuh", category: "skill" }],
    screening: { salary: { min: 2800, max: 3600, currency: "EUR", period: "month", basis: "gross" } },
    postings: [
      { id: "posting-gh", site: "job-boards.greenhouse.io", url: "https://job-boards.greenhouse.io/kestrel/jobs/4410", firstSeenAt: "2026-10-10T08:00:00Z", source: { name: "Kestrel Payments", kind: "greenhouse", label: "Greenhouse", category: "ats" } },
    ],
    target: { postingId: "posting-gh" },
    ...overrides,
  };
}

export async function started(t: ReturnType<typeof mira>, job = kestrelJob()) {
  const r = t.preparation.startPackage(job);
  if (!r.started) throw new Error(r.reason);
  return (await t.preparation.packageSettled(r.package.id))!;
}

/** Approves steps 1–4 (the salary answered), leaving the ATS check. */
export async function upToAts(t: ReturnType<typeof mira>, job = kestrelJob()) {
  const pkg = await started(t, job);
  for (const step of ["target", "cv", "letter"] as const) {
    const r = t.preparation.approveStep(pkg.id, step);
    if (!r.approved) throw new Error(r.reason);
  }
  t.preparation.setScreeningAnswer(pkg.id, "question_31003", "3400");
  const r = t.preparation.approveStep(pkg.id, "answers");
  if (!r.approved) throw new Error(r.reason);
  return r.package;
}

/** Approves the whole package; the ATS check passes on the template-like PDF. */
export async function approved(t: ReturnType<typeof mira>, job = kestrelJob()) {
  const pkg = await upToAts(t, job);
  const r = await t.preparation.approvePackage(pkg.id);
  if (!r.approved) throw new Error(r.reason);
  return r.package;
}
