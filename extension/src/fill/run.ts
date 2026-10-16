// One "Fill this page", after the panel has matched the page to a session: read the page, ask apply-kit
// for the answers, fetch the package's files for the file fields, fill, record. The panel says what
// came of it. If apply-kit stops answering after the page was filled, what's filled stays filled and
// Undo this page still works: the previous values live in the page, not in the app.
import type { FieldAnswer, FieldOutcome, PackageFileKind, PageReading, PendingAnswer } from "@apply-kit/core";
import { submitPrompt } from "../fill-report.ts";
import type { Answer, FillClient } from "../service.ts";
import type { FileToAttach } from "./greenhouse.ts";

/** The filler's calls into the portal tab (in the panel: injected on this click). Null when Chrome refused. */
export interface PageCalls {
  read(): Promise<PageReading | null>;
  fill(answers: FieldAnswer[], files: FileToAttach[]): Promise<FieldOutcome[] | null>;
}

type Problem = Exclude<Answer<unknown>, { ok: true }>;

export type FillRun =
  | { state: "filled"; reading: PageReading; answers: FieldAnswer[]; outcomes: FieldOutcome[]; filledAt: string; paths: Map<PackageFileKind, string | null>; typed: PendingAnswer[] }
  /** The portal's confirmation page: the panel asks "Did you submit?". Nothing filled. */
  | { state: "confirmation"; reading: PageReading }
  /** The portal's "how do you want to apply?" screen (Workday's Apply Manually): the panel says what to choose. Nothing filled. */
  | { state: "start"; reading: PageReading }
  /** Stopped (Kris's Stop, or Chrome refused the page) before anything was filled. */
  | { state: "stopped"; message: string }
  /** apply-kit stopped answering before anything was filled: the page wasn't touched. */
  | { state: "no-answer"; problem: Problem }
  /** apply-kit stopped answering after the page was filled: the fields stay filled, Undo still works. */
  | { state: "stopped-mid-fill"; problem: Problem; reading: PageReading; answers: FieldAnswer[]; outcomes: FieldOutcome[]; paths: Map<PackageFileKind, string | null> };

export async function runFill({ client, page, sessionId, stopRequested, now = () => new Date() }: {
  client: FillClient; page: PageCalls; sessionId: string; stopRequested: () => boolean; now?: () => Date;
}): Promise<FillRun> {
  const reading = await page.read();
  if (!reading) return { state: "stopped", message: "Chrome didn't let apply-kit read this page. Click the apply-kit icon in the toolbar on it, then Fill this page." };
  if (stopRequested()) return { state: "stopped", message: "Stopped. Nothing was filled." };
  if (submitPrompt({ known: true, pageKind: reading.pageKind }) === "ask") return { state: "confirmation", reading };
  if (reading.pageKind === "start") return { state: "start", reading };
  const answers = await client.answer(sessionId, reading);
  if (!answers.ok) return { state: "no-answer", problem: answers };
  if (stopRequested()) return { state: "stopped", message: "Stopped. Nothing was filled." };
  // The package's files for this page's file fields only, held here just long enough to attach them.
  // One the app can't give is reported as not attached, with the file one click away.
  const files: FileToAttach[] = [];
  const paths = new Map<PackageFileKind, string | null>();
  for (const a of answers.value) {
    if (a.kind !== "file") continue;
    const file = await client.file(sessionId, a.which);
    if (!file.ok) continue;
    files.push({ which: file.value.which, fileName: file.value.fileName, type: file.value.type, base64: file.value.base64 });
    paths.set(a.which, file.value.path);
  }
  if (stopRequested()) return { state: "stopped", message: "Stopped. Nothing was filled." };
  let outcomes = await page.fill(answers.value, files);
  if (!outcomes) { files.length = 0; return { state: "stopped", message: "Chrome didn't let apply-kit fill this page. Nothing was filled." }; }
  // Workday changes the page as it's filled (its CV reading adds entries; Add adds empty ones): read
  // it again and fill what's new, in the same click, until it stops changing (three passes at most).
  let latest = reading;
  let given = answers.value;
  for (let pass = 1; pass < 3 && !stopRequested(); pass++) {
    const again = await page.read();
    if (!again || shape(again) === shape(latest)) break;
    const more = await client.answer(sessionId, again);
    if (!more.ok) break;
    const next = await page.fill(more.value, files);
    if (!next) break;
    [latest, given, outcomes] = [again, more.value, next];
  }
  files.length = 0;
  const recorded = await client.record(sessionId, latest, outcomes);
  const done = { reading: latest, answers: given, outcomes, paths };
  if (!recorded.ok && recorded.state !== "error") return { state: "stopped-mid-fill", problem: recorded, ...done };
  return { state: "filled", ...done, filledAt: recorded.ok ? recorded.value.filledAt : now().toISOString(), typed: recorded.ok ? recorded.value.typedAnswers ?? [] : [] };
}

/** The page's fields and how many entries each repeating section has: what changes when the portal adds entries. */
const shape = (r: PageReading) => r.fields.map((f) => `${f.id}:${f.kind === "repeating" ? f.value : ""}`).join("|");
