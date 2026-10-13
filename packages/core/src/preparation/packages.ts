// Packages (ticket #62): one per Job, with five steps approved in order (target posting, CV
// version, cover letter, screening answers, ATS check) and the parts generated for them. Starting a
// package picks the closest angle, the recommended target posting and the posting's language, then
// generates the parts in the background within the monthly AI budget: a part that would cross the
// cap isn't started, a failed part is retried once and then waits for Retry, and stopping keeps
// what's finished. Stored in SQLite (ADR 0003); the CV's draft PDF is in the packages folder.
import { angleLabel, type Angle } from "../fit/angles.ts";
import type { AiBudget } from "../budget.ts";
import type { Clock, SqlDatabase } from "../ports.ts";
import type { CvContent, DocumentDate, DocumentLanguage, DocumentToRender } from "../documents/content.ts";
import type { AtsCheck } from "../documents/ats.ts";
import type { TailorCvInput, Writer } from "../writing/writer.ts";
import type { AngleChoice, AnglePosting } from "./angles.ts";
import type { Contact } from "./contact.ts";
import type { FileStore, PackageFolder } from "./ports.ts";
import type { ProfilePiece } from "./profile.ts";
import type { DocumentDraft, DraftRequest } from "./engine.ts";

export const packageSteps = ["target", "cv", "letter", "answers", "ats"] as const;
export type PackageStep = (typeof packageSteps)[number];

export const stepLabel: Record<PackageStep, string> = {
  target: "Target posting",
  cv: "CV version",
  letter: "Cover letter",
  answers: "Screening answers",
  ats: "ATS check",
};

/** Every tunable number behind packages, in one place. Starting guesses: tune them against real packages. */
export const packageRules = {
  /** A failed model call is tried this many times in all before the part waits for Retry. */
  attempts: 2,
  /** About how long each part takes, in seconds, for the time estimate. */
  seconds: { target: 0, cv: 20, letter: 15, answers: 15, ats: 2 } satisfies Record<PackageStep, number>,
  /** The time goal from opening the job to an approved package, in minutes (shown neutrally). */
  goalMinutes: 10,
} as const;

/** The Job a package is for, as Discover reads it: a JobDetail fits. */
export interface PackageJob {
  id: string;
  title: string;
  titleTranslation: string | null;
  company: string;
  location: string | null;
  /** The language the posting asks for: Bulgarian for a Bulgarian posting, English otherwise. */
  packageLanguage: DocumentLanguage;
  closed: { at: string; how: string; decisionId: string } | null;
  reading: { state: string };
  requirements: { text: string }[];
  postings: {
    id: string;
    site: string;
    url: string;
    source: { name: string; kind: string; label: string; category: string };
  }[];
  target: { postingId: string };
}

/** Why a package can't start, in the Job page's words. */
export type PrepareProblem = "closed" | "not-read" | "no-profile";

/** What the Job page's Prepare button shows for a package that exists. */
export interface PackageChip {
  packageId: string;
  /** Preparing (parts still being written), continue (a step waits for Kris), or ready. */
  kind: "preparing" | "continue" | "ready";
  /** "Preparing package", "Continue package · step 2 of 5", "Package ready". */
  label: string;
  /** The step Kris is at (1–5). */
  step: number;
}

export type PrepareStatus =
  | { canStart: true; package: PackageChip | null }
  | { canStart: false; problem: PrepareProblem; reason: string; package: PackageChip | null };

/**
 * A part's state: waiting to be written, working, done, failed (after the automatic retry), stopped
 * by Kris, not written (the AI budget would have been crossed), or later (not built yet).
 */
export type PartState = "waiting" | "working" | "done" | "failed" | "stopped" | "not-written" | "later";

export interface PackagePart {
  part: PackageStep;
  label: string;
  state: PartState;
  /** What it is or why it's in this state, in plain words. */
  what: string;
  /** How many times the model was asked for it. */
  attempts: number;
  /** Why the last attempt failed. */
  error: string | null;
  /** What it cost so far, in USD. */
  costUsd: number;
  /** Whether it needs the model (only those stop at the cap). */
  needsModel: boolean;
}

/** A step as the stepper shows it. States never only by colour: each has its sub-label. */
export type StepState = "done" | "current" | "flagged" | "working" | "failed" | "upcoming";

export interface PackageStepView {
  step: PackageStep;
  /** 1–5. */
  number: number;
  label: string;
  state: StepState;
  /** "Approved", "Choose", "Writing…", "Failed", "Not built yet". */
  sub: string;
  approvedAt: string | null;
  /** Null when Approve would work; otherwise why it can't, in plain words. */
  blocked: string | null;
}

/** One posting Kris could apply through, with what choosing it means. */
export interface TargetOption {
  postingId: string;
  site: string;
  url: string;
  /** The company's own page, where the CV goes straight into its system. */
  recommended: boolean;
  consequence: string;
}

/** The CV's current draft file: the exact PDF, read back. */
export interface CvDraftView {
  fileName: string;
  path: string;
  sha256: string;
  size: number;
  pages: number;
  overflow: DocumentDraft["overflow"];
  ats: AtsCheck | null;
  language: DocumentLanguage;
  photo: boolean;
}

export interface PackageView {
  id: string;
  jobId: string;
  title: string;
  company: string;
  startedAt: string;
  language: DocumentLanguage;
  /** The posting's own language, which the package started in. */
  postingLanguage: DocumentLanguage;
  angle: { angle: Angle; label: string; reason: string };
  targetPostingId: string;
  targetOptions: TargetOption[];
  /** Whether the CV shows the photo, and whether there is one in Profile to show. */
  photo: boolean;
  photoAvailable: boolean;
  parts: PackagePart[];
  /** Parts done out of the five. */
  partsReady: number;
  /** True while a part is being written. */
  generating: boolean;
  /** When Kris stopped generating, if he did. */
  stoppedAt: string | null;
  steps: PackageStepView[];
  cv: CvDraftView | null;
  /** What the package has cost so far, and the estimate for what's still to be written. */
  costUsd: number;
  estimate: { costUsd: number; seconds: number };
  chip: PackageChip;
}

export type StartPackageResult =
  | { started: true; package: PackageView }
  | { started: false; problem: PrepareProblem; reason: string };

export type ApproveResult =
  | { approved: true; package: PackageView }
  | { approved: false; reason: string; /** The step that blocks it: the one to move focus to. */ blockedBy: PackageStep; package: PackageView };

export type ChangeResult = { changed: true; package: PackageView } | { changed: false; reason: string; package: PackageView };

export interface PackageStoreDeps {
  db: SqlDatabase;
  clock: Clock;
  budget: AiBudget;
  writer: Writer;
  files: FileStore;
  packages: PackageFolder;
  pieces: () => ProfilePiece[];
  contact: () => Contact;
  closestAngle: (posting: AnglePosting) => AngleChoice;
  draftDocument: (request: DraftRequest) => Promise<DocumentDraft>;
}

export interface PackageStore {
  status(job: PackageJob): PrepareStatus;
  start(job: PackageJob): StartPackageResult;
  get(id: string): PackageView | null;
  forJob(jobId: string): PackageView | null;
  chips(jobIds: string[]): Record<string, PackageChip>;
  settled(id: string): Promise<PackageView | null>;
  approve(id: string, step: PackageStep): ApproveResult;
  setTarget(id: string, postingId: string): ChangeResult;
  setLanguage(id: string, language: DocumentLanguage): Promise<ChangeResult>;
  setPhoto(id: string, on: boolean): Promise<ChangeResult>;
  stop(id: string): PackageView;
  retry(id: string, part: PackageStep): ChangeResult;
  cvFile(id: string): Promise<{ fileName: string; pdf: Uint8Array } | null>;
}

/** Sources that are the company's own careers system (an ATS, or a company's own jobs API). */
const ownSystems = new Set(["amazon", "microsoft"]);
const isOwnPage = (p: PackageJob["postings"][number]) => p.source.category === "ats" || ownSystems.has(p.source.kind);

function consequence(p: PackageJob["postings"][number]): string {
  if (isOwnPage(p)) return "The company's own page. Your CV goes straight into their system and no account is needed.";
  switch (p.source.category) {
    case "email":
      return `From a ${p.source.label} alert email. The site may send its own profile of you rather than this tailored CV, so you'd likely apply by hand.`;
    case "capture":
      return "A page you captured. Check it still takes applications before you apply through it.";
    default:
      return `A job board's copy. It may forward you to the company's form and mark you as coming from ${p.site}. Pick it only if you want the board credited.`;
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function createPackageStore(deps: PackageStoreDeps): PackageStore {
  const { db, clock } = deps;
  /** The generation running for each package, so callers (and tests) can wait for it. */
  const running = new Map<string, Promise<void>>();
  // A part left being written when the app stopped can't finish: it shows as failed, ready for Retry.
  db.prepare("UPDATE package_part SET state = 'failed', error = ?, updated_at = ? WHERE state = 'working'")
    .run("apply-kit stopped while this was being written", clock.now().toISOString());

  // ---- reading -----------------------------------------------------------------------------

  interface Row {
    id: string; jobId: string; job: PackageJob; angle: Angle; angleReason: string; language: DocumentLanguage;
    targetPostingId: string; photo: boolean; approved: Partial<Record<PackageStep, string>>; reviewed: boolean; cvDraft: CvDraftView | null;
    startedAt: string; stoppedAt: string | null;
  }
  interface PartRow { part: PackageStep; state: PartState; attempts: number; error: string | null; costUsd: number; output: unknown }

  const toRow = (r: Record<string, unknown>): Row => ({
    id: String(r.id), jobId: String(r.job_id), job: JSON.parse(String(r.job)) as PackageJob, angle: r.angle as Angle,
    angleReason: String(r.angle_reason), language: r.language as DocumentLanguage, targetPostingId: String(r.target_posting_id),
    photo: Number(r.photo) === 1, approved: JSON.parse(String(r.approved)) as Row["approved"], reviewed: r.reviewed_at != null,
    cvDraft: r.cv_draft == null ? null : (JSON.parse(String(r.cv_draft)) as CvDraftView),
    startedAt: String(r.started_at), stoppedAt: r.stopped_at == null ? null : String(r.stopped_at),
  });
  const row = (id: string) => {
    const r = db.prepare("SELECT * FROM package WHERE id = ?").get(id);
    return r ? toRow(r) : null;
  };
  const parts = (id: string): Map<PackageStep, PartRow> => new Map(
    db.prepare("SELECT * FROM package_part WHERE package_id = ?").all(id).map((r) => [r.part as PackageStep, {
      part: r.part as PackageStep, state: r.state as PartState, attempts: Number(r.attempts),
      error: r.error == null ? null : String(r.error), costUsd: Number(r.cost_usd),
      output: r.output == null ? null : JSON.parse(String(r.output)),
    }]),
  );
  const setPart = (id: string, part: PackageStep, fields: Partial<Omit<PartRow, "part">>) => {
    const sets = Object.entries({
      state: fields.state, attempts: fields.attempts, error: fields.error, cost_usd: fields.costUsd,
      output: fields.output === undefined ? undefined : JSON.stringify(fields.output),
    }).filter(([, v]) => v !== undefined);
    db.prepare(`UPDATE package_part SET ${[...sets.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ")} WHERE package_id = ? AND part = ?`)
      .run(...sets.map(([, v]) => v as string | number | null), clock.now().toISOString(), id, part);
  };

  const modelParts: PackageStep[] = ["cv"];
  const partWhat = (r: Row, p: PartRow): string => {
    const target = r.job.postings.find((x) => x.id === r.targetPostingId);
    const language = r.language === "bg" ? "Bulgarian" : "English";
    switch (p.part) {
      case "target":
        return `${target?.site ?? "The job's posting"}${target && isOwnPage(target) ? ", the company's own page" : ""} · ${language}${r.language === r.job.packageLanguage ? ", from the posting" : ""}`;
      case "cv":
        return p.state === "working" ? `${angleLabel[r.angle]} angle · writing from your profile`
          : p.state === "done" ? `${angleLabel[r.angle]} angle · ${r.cvDraft?.pages === 1 ? "1 page" : `${r.cvDraft?.pages ?? 0} pages`}`
          : p.state === "failed" ? `Not written: ${p.error ?? "the model didn't answer"}. The rest is saved.`
          : p.state === "stopped" ? "Stopped before it was written. Generate it again when you like."
          : p.state === "not-written" ? "Not written: this month's AI budget would be crossed."
          : `${angleLabel[r.angle]} angle`;
      case "letter":
      case "answers":
        return "Arrives with a later part of the rebuild.";
      case "ats":
        return "Reads the CV PDF once you approve the CV. Runs on this laptop, no model needed.";
    }
  };

  const isGenerating = (r: Row, ps: Map<PackageStep, PartRow>) =>
    [...ps.values()].some((p) => p.state === "working" || (p.state === "waiting" && modelParts.includes(p.part) && !r.stoppedAt));

  function chipOf(r: Row, ps: Map<PackageStep, PartRow>): PackageChip {
    const first = packageSteps.findIndex((s) => !r.approved[s]);
    const step = first === -1 ? packageSteps.length : first + 1;
    if (isGenerating(r, ps)) return { packageId: r.id, kind: "preparing", label: "Preparing package", step };
    // Ready: everything written and Kris hasn't started reviewing, or every step approved.
    const allWritten = [...ps.values()].every((p) => p.state === "done" || p.state === "later" || p.part === "ats");
    if (first === -1 || (!r.reviewed && allWritten)) return { packageId: r.id, kind: "ready", label: "Package ready", step };
    return { packageId: r.id, kind: "continue", label: `Continue package · step ${step} of ${packageSteps.length}`, step };
  }

  /** Why a step can't be approved now, and the step that blocks it; null when it can. */
  function blockOf(r: Row, ps: Map<PackageStep, PartRow>, step: PackageStep): { reason: string; by: PackageStep } | null {
    const n = packageSteps.indexOf(step);
    const before = packageSteps.slice(0, n).find((s) => !r.approved[s]);
    if (before) {
      const m = packageSteps.indexOf(before) + 1;
      return { reason: `Approve step ${m}, ${stepLabel[before]}, first. Steps are approved in order, so a later part never contradicts an earlier decision.`, by: before };
    }
    const p = ps.get(step)!;
    const name = lower(stepLabel[step]);
    switch (p.state) {
      case "done": return null;
      case "working": return { reason: `The ${name} is still being written.`, by: step };
      case "waiting": return step === "ats"
        ? { reason: "The ATS check runs once the CV is approved.", by: step }
        : { reason: `The ${name} hasn't been written yet.`, by: step };
      case "later": return { reason: `The ${name} arrives with a later part of the rebuild.`, by: step };
      default: return { reason: `There's no ${name} to approve: it wasn't written. Retry it first.`, by: step };
    }
  }

  function stepsOf(r: Row, ps: Map<PackageStep, PartRow>): PackageStepView[] {
    const current = packageSteps.find((s) => !r.approved[s]);
    return packageSteps.map((step, i) => {
      const p = ps.get(step)!;
      const approvedAt = r.approved[step] ?? null;
      const block = blockOf(r, ps, step);
      const [state, sub]: [StepState, string] = approvedAt ? ["done", "Approved"]
        : p.state === "working" ? ["working", "Writing…"]
        : p.state === "failed" ? ["failed", "Failed"]
        : step === current ? ["current", p.state === "done" ? (step === "target" ? "Choose" : "Ready to check") : p.state === "later" ? "Not built yet" : "Not written"]
        : p.state === "later" ? ["upcoming", "Not built yet"]
        : p.state === "stopped" || p.state === "not-written" ? ["upcoming", "Not written"]
        : step === "ats" ? ["upcoming", "After the CV"]
        : ["upcoming", p.state === "done" ? "Drafted" : "Waiting"];
      return { step, number: i + 1, label: stepLabel[step], state, sub, approvedAt, blocked: approvedAt ? null : block?.reason ?? null };
    });
  }

  function view(r: Row): PackageView {
    const ps = parts(r.id);
    const list = packageSteps.map((s) => ps.get(s)!);
    const toWrite = list.filter((p) => modelParts.includes(p.part) && (p.state === "waiting" || p.state === "working"));
    const contact = deps.contact();
    const recommended = r.job.postings.find(isOwnPage)?.id ?? null;
    return {
      id: r.id,
      jobId: r.jobId,
      title: r.job.titleTranslation ?? r.job.title,
      company: r.job.company,
      startedAt: r.startedAt,
      language: r.language,
      postingLanguage: r.job.packageLanguage,
      angle: { angle: r.angle, label: angleLabel[r.angle], reason: r.angleReason },
      targetPostingId: r.targetPostingId,
      targetOptions: r.job.postings.map((p) => ({ postingId: p.id, site: p.site, url: p.url, recommended: p.id === recommended, consequence: consequence(p) }))
        .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
      photo: r.photo,
      photoAvailable: contact.photo !== null,
      parts: list.map((p) => ({
        part: p.part, label: stepLabel[p.part], state: p.state, what: partWhat(r, p), attempts: p.attempts, error: p.error,
        costUsd: p.costUsd, needsModel: modelParts.includes(p.part),
      })),
      partsReady: list.filter((p) => p.state === "done").length,
      generating: isGenerating(r, ps),
      stoppedAt: r.stoppedAt,
      steps: stepsOf(r, ps),
      cv: r.cvDraft,
      costUsd: Math.round(list.reduce((n, p) => n + p.costUsd, 0) * 1e6) / 1e6,
      estimate: {
        // Only the CV needs the model so far; later parts add their own task's estimate here.
        costUsd: toWrite.length ? Math.round(deps.writer.estimateCostUsd({ task: "tailor-cv", input: tailorInput(r) }) * 1e6) / 1e6 : 0,
        seconds: toWrite.reduce((n, p) => n + packageRules.seconds[p.part], 0),
      },
      chip: chipOf(r, ps),
    };
  }

  // ---- the CV --------------------------------------------------------------------------------

  /** Confirmed pieces: the only ones a package may use until it has learned pieces of its own (#64). */
  const confirmed = () => deps.pieces().filter((p) => p.status === "confirmed");

  function tailorInput(r: Row): TailorCvInput {
    const angle = deps.closestAngle(r.job);
    return {
      posting: { title: r.job.title, company: r.job.company, requirements: r.job.requirements.map((q) => q.text) },
      language: r.language,
      angle: { label: angleLabel[r.angle], summary: angle.angle === r.angle ? angle.summary : "" },
      pieces: confirmed().map((p) => ({ id: p.id, kind: p.kind, text: p.text, entry: p.entry && { title: p.entry.title, organisation: p.entry.organisation, start: p.entry.start, end: p.entry.end } })),
    };
  }

  const month = (ym: string): DocumentDate => {
    const [y, m] = ym.split("-").map(Number);
    return Number.isFinite(y) ? (m ? { year: y!, month: m } : { year: y! }) : { text: ym };
  };

  /**
   * The placeholder CV: the angle's confirmed pieces as stored, through the template. Every role
   * stays (the timeline is never shortened); bullets are the angle's achievements, leads first.
   * Tailored lines replace these once the honesty validator checks them (#63).
   */
  async function cvDocument(r: Row): Promise<DocumentToRender> {
    const pieces = confirmed();
    const contact = deps.contact();
    const choice = deps.closestAngle(r.job);
    const leads = choice.angle === r.angle ? choice.leads.map((p) => p.id) : [];
    const rank = (p: ProfilePiece) => (leads.includes(p.id) ? leads.indexOf(p.id) : leads.length);
    const byEnd = (a: ProfilePiece, b: ProfilePiece) => (b.entry!.end ?? "9999").localeCompare(a.entry!.end ?? "9999") || b.entry!.start.localeCompare(a.entry!.start);
    const roles = pieces.filter((p) => p.kind === "role" && p.entry).sort(byEnd);
    const ofAngle = (p: ProfilePiece) => p.angles.includes(r.angle);
    const name = r.language === "bg" && contact.nameCyrillic ? contact.nameCyrillic : contact.nameLatin;
    const content: CvContent = {
      letterhead: {
        name,
        headline: roles[0]?.entry?.title ?? "",
        location: [contact.city, contact.country].filter(Boolean).join(", ") || undefined,
        email: contact.email,
        phone: contact.phone || undefined,
        links: contact.links.map((l) => l.replace(/^https?:\/\//, "").replace(/\/$/, "")),
      },
      summary: r.angle === choice.angle ? choice.summary : "",
      experience: roles.map((role) => ({
        title: role.entry!.title,
        employer: role.entry!.organisation,
        place: role.entry!.city ?? undefined,
        start: month(role.entry!.start),
        end: role.entry!.end ? month(role.entry!.end) : "present",
        bullets: pieces.filter((p) => p.kind === "achievement" && p.belongsTo === role.id && ofAngle(p))
          .sort((a, b) => rank(a) - rank(b)).map((p) => p.text.replace(/\.$/, "")),
      })),
      skills: pieces.filter((p) => p.kind === "skill" && ofAngle(p)).sort((a, b) => rank(a) - rank(b)).map((p) => p.text),
      education: pieces.filter((p) => p.kind === "education" && p.entry).sort(byEnd).map((e) => ({
        degree: e.entry!.title, school: e.entry!.organisation, start: month(e.entry!.start), end: e.entry!.end ? month(e.entry!.end) : { text: "" },
      })),
      languagesAndCourses: [],
    };
    if (r.photo && contact.photo) {
      const bytes = await deps.files.get(contact.photo.sha256);
      if (bytes) content.photo = { mediaType: bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg", bytes };
    }
    return { kind: "cv", language: r.language, title: `${name} · CV · ${r.job.company}`, content };
  }

  /** Prints the CV and keeps it as the package's draft. */
  async function renderCv(id: string): Promise<void> {
    const r = row(id)!;
    const draft = await deps.draftDocument({
      packageId: id,
      document: await cvDocument(r),
      fileName: { name: deps.contact().nameLatin, company: r.job.company, role: r.job.title },
      keywords: [],
    });
    const cv: CvDraftView = {
      fileName: draft.fileName, path: draft.path, sha256: draft.sha256, size: draft.size, pages: draft.pages,
      overflow: draft.overflow, ats: draft.ats, language: r.language, photo: r.photo,
    };
    db.prepare("UPDATE package SET cv_draft = ? WHERE id = ?").run(JSON.stringify(cv), id);
  }

  // ---- generating ----------------------------------------------------------------------------

  const stopped = (id: string) => row(id)?.stoppedAt != null;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  /** Writes the CV part: the tailoring call (retried once on failure) within the cap, then the PDF. */
  async function writeCv(id: string): Promise<void> {
    let { attempts, costUsd } = parts(id).get("cv")!;
    setPart(id, "cv", { state: "working", error: null });
    for (let tries = 0; tries < packageRules.attempts; tries++) {
      if (stopped(id)) return;
      const input = tailorInput(row(id)!);
      attempts += 1;
      let outcome;
      try {
        outcome = await deps.budget.call(
          { task: "tailor-cv", estimateUsd: deps.writer.estimateCostUsd({ task: "tailor-cv", input }) },
          () => deps.writer.tailorCv(input),
        );
      } catch (err) {
        const billed = (err as { costUsd?: unknown } | null)?.costUsd;
        if (typeof billed === "number" && billed > 0) costUsd += billed;
        const last = tries === packageRules.attempts - 1;
        if (stopped(id)) { setPart(id, "cv", { attempts, costUsd, error: message(err) }); return; }
        setPart(id, "cv", { attempts, costUsd, error: message(err), ...(last && { state: "failed" }) });
        if (last) return;
        continue;
      }
      if (outcome.refused) {
        setPart(id, "cv", { state: "not-written", attempts: attempts - 1, error: null });
        return;
      }
      costUsd += outcome.result.costUsd;
      // Stopped while the model was writing: the call is paid for, but its answer isn't used.
      if (stopped(id)) { setPart(id, "cv", { attempts, costUsd }); return; }
      setPart(id, "cv", { attempts, costUsd, output: outcome.result.output });
      try {
        await renderCv(id);
      } catch (err) {
        setPart(id, "cv", { state: "failed", error: `The PDF couldn't be printed: ${message(err)}` });
        return;
      }
      setPart(id, "cv", { state: "done", error: null });
      return;
    }
  }

  function generate(id: string): void {
    // Parts about to be written show as working at once, so the package never looks idle.
    for (const part of modelParts) if (parts(id).get(part)!.state === "waiting") setPart(id, part, { state: "working" });
    const before = running.get(id) ?? Promise.resolve();
    const run = before.then(async () => {
      for (const part of modelParts) {
        const state = parts(id).get(part)!.state;
        if (state === "working" && !stopped(id)) await writeCv(id);
      }
    }).catch((err: unknown) => {
      // Never leave a part spinning: whatever broke, the part shows as failed with Retry.
      for (const p of parts(id).values()) if (p.state === "working") setPart(id, p.part, { state: "failed", error: message(err) });
    });
    running.set(id, run);
  }

  // ---- operations ----------------------------------------------------------------------------

  const forJob = (jobId: string) => {
    const r = db.prepare("SELECT * FROM package WHERE job_id = ?").get(jobId);
    return r ? toRow(r) : null;
  };

  function status(job: PackageJob): PrepareStatus {
    const existing = forJob(job.id);
    const chip = existing ? chipOf(existing, parts(existing.id)) : null;
    if (job.closed) {
      return {
        canStart: false, problem: "closed", package: chip,
        reason: `Can't prepare a package: this job is closed (${lower(job.closed.how)}), so the posting may no longer accept applications. If it's still open, reopen it first.`,
      };
    }
    if (job.reading.state !== "read") {
      return {
        canStart: false, problem: "not-read", package: chip,
        reason: "Can't prepare a package yet: the posting's requirements haven't been read, and every part of a package is built against them.",
      };
    }
    if (!existing && confirmed().length === 0) {
      return { canStart: false, problem: "no-profile", package: null, reason: "A package needs your master profile first: every part is built from it." };
    }
    return { canStart: true, package: chip };
  }

  function start(job: PackageJob): StartPackageResult {
    const existing = forJob(job.id);
    if (existing) return { started: true, package: view(existing) };
    const s = status(job);
    if (!s.canStart) return { started: false, problem: s.problem, reason: s.reason };
    const id = crypto.randomUUID();
    const angle = deps.closestAngle(job);
    const target = job.postings.find(isOwnPage) ?? job.postings.find((p) => p.id === job.target.postingId) ?? job.postings[0];
    const now = clock.now().toISOString();
    const snapshot: PackageJob = {
      id: job.id, title: job.title, titleTranslation: job.titleTranslation, company: job.company, location: job.location,
      packageLanguage: job.packageLanguage, closed: null, reading: { state: job.reading.state },
      requirements: job.requirements.map((q) => ({ text: q.text })),
      postings: job.postings.map((p) => ({ id: p.id, site: p.site, url: p.url, source: { name: p.source.name, kind: p.source.kind, label: p.source.label, category: p.source.category } })),
      target: { postingId: job.target.postingId },
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO package (id, job_id, job, angle, angle_reason, language, target_posting_id, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, job.id, JSON.stringify(snapshot), angle.angle, angle.reason, job.packageLanguage, target?.id ?? "", now);
      const initial: Record<PackageStep, PartState> = { target: "done", cv: "waiting", letter: "later", answers: "later", ats: "waiting" };
      for (const step of packageSteps) {
        db.prepare("INSERT INTO package_part (package_id, part, state, updated_at) VALUES (?, ?, ?, ?)").run(id, step, initial[step], now);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    generate(id);
    return { started: true, package: view(row(id)!) };
  }

  /** Editing an approved part reopens its step and every later one. */
  const reopenFrom = (r: Row, step: PackageStep) => {
    const from = packageSteps.indexOf(step);
    const approved = Object.fromEntries(Object.entries(r.approved).filter(([s]) => packageSteps.indexOf(s as PackageStep) < from));
    db.prepare("UPDATE package SET approved = ? WHERE id = ?").run(JSON.stringify(approved), r.id);
  };

  const mustGet = (id: string) => {
    const r = row(id);
    if (!r) throw new Error("No such package");
    return r;
  };

  return {
    status,
    start,
    get: (id) => { const r = row(id); return r ? view(r) : null; },
    forJob: (jobId) => { const r = forJob(jobId); return r ? view(r) : null; },
    chips(jobIds) {
      const out: Record<string, PackageChip> = {};
      for (const jobId of jobIds) {
        const r = forJob(jobId);
        if (r) out[jobId] = chipOf(r, parts(r.id));
      }
      return out;
    },
    async settled(id) {
      await running.get(id);
      const r = row(id);
      return r ? view(r) : null;
    },

    approve(id, step) {
      const r = mustGet(id);
      if (r.approved[step]) return { approved: true, package: view(r) };
      const block = blockOf(r, parts(id), step);
      if (block) return { approved: false, reason: block.reason, blockedBy: block.by, package: view(r) };
      const now = clock.now().toISOString();
      db.prepare("UPDATE package SET approved = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?").run(JSON.stringify({ ...r.approved, [step]: now }), now, id);
      return { approved: true, package: view(row(id)!) };
    },

    setTarget(id, postingId) {
      const r = mustGet(id);
      if (!r.job.postings.some((p) => p.id === postingId)) return { changed: false, reason: "That posting isn't one of this job's.", package: view(r) };
      if (postingId !== r.targetPostingId) {
        db.prepare("UPDATE package SET target_posting_id = ? WHERE id = ?").run(postingId, id);
        reopenFrom(r, "target");
      }
      return { changed: true, package: view(row(id)!) };
    },

    async setLanguage(id, language) {
      const r = mustGet(id);
      if (language !== r.language) {
        db.prepare("UPDATE package SET language = ? WHERE id = ?").run(language, id);
        reopenFrom(r, "target");
        // Until the other parts exist, switching only prints the CV again in the new language.
        if (parts(id).get("cv")!.state === "done") await renderCv(id);
      }
      return { changed: true, package: view(row(id)!) };
    },

    async setPhoto(id, on) {
      const r = mustGet(id);
      if (on && !deps.contact().photo) return { changed: false, reason: "There's no photo in Profile yet. Add one under Contact details first.", package: view(r) };
      if (on !== r.photo) {
        db.prepare("UPDATE package SET photo = ? WHERE id = ?").run(on ? 1 : 0, id);
        reopenFrom(r, "cv");
        if (parts(id).get("cv")!.state === "done") await renderCv(id);
      }
      return { changed: true, package: view(row(id)!) };
    },

    stop(id) {
      const r = mustGet(id);
      if (!r.stoppedAt) db.prepare("UPDATE package SET stopped_at = ? WHERE id = ?").run(clock.now().toISOString(), id);
      for (const p of parts(id).values()) {
        if (modelParts.includes(p.part) && (p.state === "waiting" || p.state === "working")) setPart(id, p.part, { state: "stopped" });
      }
      return view(row(id)!);
    },

    retry(id, part) {
      const r = mustGet(id);
      const p = parts(id).get(part)!;
      if (!modelParts.includes(part) || !["failed", "stopped", "not-written"].includes(p.state)) {
        return { changed: false, reason: `The ${lower(stepLabel[part])} has nothing to retry.`, package: view(r) };
      }
      db.prepare("UPDATE package SET stopped_at = NULL WHERE id = ?").run(id);
      setPart(id, part, { state: "waiting", error: null });
      reopenFrom(r, part);
      generate(id);
      return { changed: true, package: view(row(id)!) };
    },

    async cvFile(id) {
      const r = row(id);
      if (!r?.cvDraft) return null;
      const pdf = await deps.packages.read(r.cvDraft.path);
      return pdf ? { fileName: r.cvDraft.fileName, pdf } : null;
    },

  };
}
