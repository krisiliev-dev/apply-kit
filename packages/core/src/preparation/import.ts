// Import (ticket #54): old CVs, the LinkedIn export, a GitHub profile and a portfolio page become
// drafted profile pieces for Kris to check. Files are copied into the file store; their text is read
// on this laptop and only that text goes to the writer, within the monthly AI budget. The LinkedIn
// export and GitHub are read without the model. Each source finishes on its own: its pieces are in
// Profile (unconfirmed) as soon as it's done, a file that can't be read says why and waits for
// Kris's choice, a file the budget can't cover waits, and cancelling keeps what was drafted.
import { parse as parseHtml } from "node-html-parser";
import type { BudgetInfo } from "../budget.ts";
import type { DraftedPieces } from "../writing/writer.ts";
import { disagrees, isNearDuplicate } from "./duplicates.ts";
import { docxText, fileTypeOf, pdfPlainText, plainText, quoteIsIn, type ImportFileType } from "./extract.ts";
import { linkedInPieces } from "./linkedin.ts";
import type { PreparationDeps } from "./ports.ts";
import type { PieceEntry, PieceKind, PieceSource, ProfileStore } from "./profile.ts";
import { readZip, ZipError } from "./zip.ts";

export type { ImportFileType } from "./extract.ts";

export type ImportSource = "file" | "linkedin" | "github" | "portfolio";

/** queued → reading → done; or unreadable (waits for Kris's choice), waiting (the budget), skipped, cancelled. */
export type ImportItemState = "queued" | "reading" | "done" | "unreadable" | "waiting" | "skipped" | "cancelled";

export type UnreadableReason =
  | "scanned" | "pages" | "old-word" | "unsupported" | "damaged" | "empty" | "not-recognised" | "not-linkedin" | "unreachable" | "failed";

/** What Kris can do about a source that couldn't be read. */
export type UnreadableAction = "recognise" | "text-version" | "retry" | "skip";

export interface ImportProblem {
  reason: UnreadableReason;
  /** Why, in plain words. */
  message: string;
  options: UnreadableAction[];
}

export interface ImportItem {
  id: string;
  source: ImportSource;
  /** The file's name, or the link. */
  name: string;
  type: ImportFileType;
  /** The copy in the file store (files only). */
  sha256: string | null;
  size: number | null;
  state: ImportItemState;
  /** What was found, e.g. "14 public repositories". */
  detail: string | null;
  problem: ImportProblem | null;
  /** Why a waiting source waits: the monthly cap, or the service stopped while it was reading. */
  waitingFor: "budget" | "restart" | null;
  /** New pieces drafted from it, and pieces it said the same as (merged into one already there). */
  pieces: number;
  merged: number;
  /** Read by text recognition: its pieces are marked "check this". */
  recognised: boolean;
  /** For a source waiting on the budget: what drafting from it is estimated to cost. */
  estimateUsd: number | null;
}

export interface ImportStatus {
  id: string;
  state: "running" | "finished" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  items: ImportItem[];
  /** Sources read (done), out of all of them. */
  done: number;
  total: number;
  /** A rough estimate while it runs, from how long finished sources took. */
  secondsLeft: number | null;
  /** New pieces drafted so far, and how many sources' pieces merged into ones already there. */
  pieces: number;
  merged: number;
  budget: BudgetInfo;
  /** What the sources waiting on the budget are estimated to cost together. */
  waitingCostUsd: number;
}

export interface ImportFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface ImportInput {
  /** Old CVs and cover letters: PDF, DOCX or TXT. */
  files?: ImportFile[];
  /** The LinkedIn data export (.zip). */
  linkedIn?: ImportFile | null;
  /** "github.com/name" or its full link. */
  github?: string | null;
  portfolio?: string | null;
}

export type ImportField = "files" | "linkedIn" | "github" | "portfolio";
export interface ImportInputProblem {
  field: ImportField;
  message: string;
}

/** A running (or finished) import: its status now, and its status once every queued source is done. */
export interface ImportRun {
  status: ImportStatus;
  done: Promise<ImportStatus>;
}

export type StartImportResult = ({ started: true } & ImportRun) | { started: false; problems: ImportInputProblem[] };

export type UnreadableChoice =
  | { action: "recognise" }
  | { action: "retry" }
  | { action: "skip" }
  | { action: "text-version"; file: ImportFile };

export type ResolveResult = ({ resolved: true } & ImportRun) | { resolved: false; message: string };

/** A source that said the same as a piece already there, merged into it. */
export interface ImportMerge {
  pieceId: string;
  /** The piece as it stands (a role's or education's title and organisation). */
  piece: string;
  /** Where the piece itself came from. */
  kept: PieceSource;
  /** The merged source: its file, its quote, and how it was worded there. */
  merged: PieceSource & { text: string };
}

/** A piece drafted from a source, with the index of the role or education entry it sits under. */
interface Drafted {
  kind: PieceKind;
  text: string;
  quote: string;
  entry: PieceEntry | null;
  role: number | null;
}

type Read =
  | { text: string; detail?: string }
  | { pieces: Drafted[]; detail?: string }
  | { problem: ImportProblem };

const GITHUB = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/?$/i;
/** How long drafting from one file takes, until finished files say otherwise. */
const DEFAULT_SECONDS_PER_DRAFT = 20;
const SECONDS_PER_LINK = 2;

const problem = (reason: UnreadableReason, message: string, options: UnreadableAction[]): ImportProblem => ({ reason, message, options });
const notReadable = (reason: UnreadableReason, message: string) => problem(reason, message, ["text-version", "skip"]);

export interface ImportStore {
  start(input: ImportInput): Promise<StartImportResult>;
  status(id?: string): ImportStatus | null;
  cancel(id: string): ImportStatus | null;
  resume(id: string): ImportRun | null;
  resolve(itemId: string, choice: UnreadableChoice): Promise<ResolveResult>;
  merges(id: string): ImportMerge[];
}

export function createImportStore(deps: PreparationDeps, profile: ProfileStore): ImportStore {
  const { db, clock } = deps;
  const now = () => clock.now().toISOString();
  /** Per run in this process: whether it was cancelled, and the sources still to read, one after another. */
  const runs = new Map<string, { cancelled: boolean; chain: Promise<void> }>();

  // Sources left reading when the service stopped wait to be resumed.
  db.prepare("UPDATE import_item SET state = 'waiting', waiting_for = 'restart' WHERE state IN ('queued', 'reading')").run();

  const rowToItem = (r: Record<string, unknown>): ImportItem => ({
    id: String(r.id),
    source: r.source as ImportSource,
    name: String(r.name),
    type: r.type as ImportFileType,
    sha256: r.sha256 == null ? null : String(r.sha256),
    size: r.size == null ? null : Number(r.size),
    state: r.state as ImportItemState,
    detail: r.detail == null ? null : String(r.detail),
    problem: r.problem == null ? null : (JSON.parse(String(r.problem)) as ImportProblem),
    waitingFor: (r.waiting_for ?? null) as ImportItem["waitingFor"],
    pieces: Number(r.pieces),
    merged: Number(r.merged),
    recognised: Number(r.recognised) === 1,
    estimateUsd: r.estimate_usd == null ? null : Number(r.estimate_usd),
  });
  const itemRow = (id: string) => db.prepare("SELECT * FROM import_item WHERE id = ?").get(id);
  const update = (id: string, fields: Record<string, string | number | null>) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE import_item SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]!), id);
  };

  function status(id?: string): ImportStatus | null {
    const run = id
      ? db.prepare("SELECT * FROM import_run WHERE id = ?").get(id)
      : db.prepare("SELECT * FROM import_run ORDER BY started_at DESC, rowid DESC LIMIT 1").get();
    if (!run) return null;
    const rows = db.prepare("SELECT * FROM import_item WHERE import_id = ? ORDER BY position").all(String(run.id));
    const items = rows.map(rowToItem);
    const running = items.some((i) => i.state === "queued" || i.state === "reading");
    return {
      id: String(run.id),
      state: running ? "running" : run.cancelled_at ? "cancelled" : "finished",
      startedAt: String(run.started_at),
      finishedAt: running || run.finished_at == null ? null : String(run.finished_at),
      items,
      done: items.filter((i) => i.state === "done").length,
      total: items.length,
      secondsLeft: running ? secondsLeft(rows) : null,
      pieces: items.reduce((n, i) => n + i.pieces, 0),
      merged: items.reduce((n, i) => n + i.merged, 0),
      budget: deps.budget.info(),
      waitingCostUsd: Math.round(items.filter((i) => i.state === "waiting" && i.waitingFor === "budget").reduce((n, i) => n + (i.estimateUsd ?? 0), 0) * 1e4) / 1e4,
    };
  }

  /** Sources still to read, at the pace finished drafts went (or a default until one has). */
  function secondsLeft(rows: Record<string, unknown>[]): number {
    const drafts = (r: Record<string, unknown>) => r.source === "file" || r.source === "portfolio";
    const took = rows
      .filter((r) => drafts(r) && r.state === "done" && r.started_at && r.finished_at)
      .map((r) => (Date.parse(String(r.finished_at)) - Date.parse(String(r.started_at))) / 1000)
      .filter((s) => s > 0);
    const pace = took.length > 0 ? took.reduce((a, b) => a + b, 0) / took.length : DEFAULT_SECONDS_PER_DRAFT;
    const left = rows.filter((r) => r.state === "queued" || r.state === "reading");
    const seconds = left.reduce((n, r) => n + (drafts(r) ? (r.state === "reading" ? pace / 2 : pace) : SECONDS_PER_LINK), 0);
    return Math.max(5, Math.round(seconds / 5) * 5);
  }

  function control(id: string) {
    let c = runs.get(id);
    if (!c) runs.set(id, (c = { cancelled: false, chain: Promise.resolve() }));
    return c;
  }

  /** Reads the sources one after another (after any already queued), and says when they're all done. */
  function enqueue(runId: string, itemIds: string[]): ImportRun {
    const c = control(runId);
    for (const id of itemIds) update(id, { state: "queued", problem: null, waiting_for: null });
    db.prepare("UPDATE import_run SET finished_at = NULL WHERE id = ?").run(runId);
    c.chain = c.chain.then(async () => {
      for (const id of itemIds) {
        if (itemRow(id)?.state !== "queued") continue;
        if (c.cancelled) update(id, { state: "cancelled" });
        else await read(c, id);
      }
      if (!db.prepare("SELECT 1 AS x FROM import_item WHERE import_id = ? AND state IN ('queued', 'reading')").get(runId)) {
        db.prepare("UPDATE import_run SET finished_at = ? WHERE id = ?").run(now(), runId);
      }
    });
    return { status: status(runId)!, done: c.chain.then(() => status(runId)!) };
  }

  /** Reads one source to the end: done, unreadable, waiting for the budget, or cancelled. */
  async function read(c: { cancelled: boolean }, id: string): Promise<void> {
    const item = rowToItem(itemRow(id)!);
    update(id, { state: "reading", started_at: now(), finished_at: null, problem: null, waiting_for: null, estimate_usd: null });
    let result: Read;
    try {
      result = await readSource(item);
    } catch (err) {
      result = { problem: problem("failed", `Something went wrong reading it: ${message(err)}`, ["retry", "skip"]) };
    }
    if (c.cancelled) return update(id, { state: "cancelled" });
    if ("problem" in result) return update(id, { state: "unreadable", problem: JSON.stringify(result.problem), finished_at: now() });
    if (result.detail) update(id, { detail: result.detail });
    if ("pieces" in result) return save(item, result.pieces);

    const text = result.text;
    update(id, { text });
    const input = { fileName: item.name, text };
    const estimateUsd = deps.writer.estimateCostUsd({ task: "draft-pieces", input });
    let drafted: DraftedPieces;
    try {
      const outcome = await deps.budget.call({ task: "draft-pieces", estimateUsd }, () => deps.writer.draftPieces(input));
      if (outcome.refused) return update(id, { state: "waiting", waiting_for: "budget", estimate_usd: estimateUsd });
      drafted = outcome.result.output;
    } catch (err) {
      if (c.cancelled) return update(id, { state: "cancelled" });
      return update(id, {
        state: "unreadable",
        problem: JSON.stringify(problem("failed", `The model couldn't draft pieces from it: ${message(err)}`, ["retry", "skip"])),
        finished_at: now(),
      });
    }
    // Cancelled while the model was writing: what it wrote isn't added.
    if (c.cancelled) return update(id, { state: "cancelled" });
    // A piece whose quote isn't in the text came from nowhere; it's left out.
    save(item, drafted.pieces.filter((p) => quoteIsIn(p.quote, text)));
  }

  async function readSource(item: ImportItem): Promise<Read> {
    if (item.source === "github") return readGitHub(item.name);
    if (item.source === "portfolio") return readPortfolio(item.name);
    const bytes = item.sha256 ? await deps.files.get(item.sha256) : null;
    if (!bytes) return { problem: notReadable("damaged", "The copy of this file is missing from the app's data folder. Upload it again.") };
    if (item.source === "linkedin") return readLinkedIn(bytes);
    return readFile(item, bytes);
  }

  async function readFile(item: ImportItem, bytes: Uint8Array): Promise<Read> {
    switch (item.type) {
      case "txt": {
        const text = plainText(bytes);
        return text ? { text } : { problem: notReadable("empty", "There's no text in it.") };
      }
      case "docx": {
        try {
          const text = docxText(bytes);
          return text ? { text } : { problem: notReadable("empty", "There's no text in it.") };
        } catch (err) {
          if (err instanceof ZipError) return { problem: notReadable("damaged", "It seems damaged: it couldn't be opened as a Word document.") };
          throw err;
        }
      }
      case "pdf": {
        if (item.recognised) {
          const text = pdfPlainText(await deps.recognizer!.recognise(bytes));
          return text ? { text } : { problem: notReadable("not-recognised", "Text recognition found no text on its pages.") };
        }
        let text: string;
        try {
          text = pdfPlainText(await deps.pdfReader.read(bytes));
        } catch {
          return { problem: notReadable("damaged", "It seems damaged: it couldn't be opened as a PDF.") };
        }
        if (text) return { text };
        return {
          problem: problem("scanned", "It's a scanned image: the pages are pictures, so there's no text to read.",
            deps.recognizer ? ["recognise", "text-version", "skip"] : ["text-version", "skip"]),
        };
      }
      case "pages":
        return { problem: notReadable("pages", "It's a Pages document, which can't be read here. In Pages, choose File › Export To › Word or PDF, and upload that.") };
      case "doc":
        return { problem: notReadable("old-word", "It's in the old Word format (.doc), which can't be read here. Save it from Word as .docx or PDF, and upload that.") };
      default:
        return { problem: notReadable("unsupported", "Only PDF, DOCX and TXT files can be read.") };
    }
  }

  function readLinkedIn(bytes: Uint8Array): Read {
    let entries: Map<string, Uint8Array>;
    try {
      entries = readZip(bytes);
    } catch {
      return { problem: notReadable("damaged", "It seems damaged: it couldn't be opened as a .zip file.") };
    }
    const found = linkedInPieces(entries);
    if (!found) {
      return { problem: notReadable("not-linkedin", "It isn't the LinkedIn export: it has no Positions.csv, Education.csv or Skills.csv. Choose the .zip LinkedIn emailed you.") };
    }
    return { pieces: found.pieces, detail: found.detail };
  }

  async function readGitHub(link: string): Promise<Read> {
    const user = GITHUB.exec(link)?.[1];
    const unreachable = (message: string) => ({ problem: problem("unreachable", message, ["retry", "skip"]) });
    if (!user || !deps.fetch) return unreachable("GitHub can't be read from here.");
    let res: Response;
    try {
      res = await deps.fetch(`https://api.github.com/users/${user}/repos?per_page=100&type=owner&sort=pushed`, {
        headers: { accept: "application/vnd.github+json" },
      });
    } catch (err) {
      return unreachable(`GitHub couldn't be reached: ${message(err)}. Try again when you're online.`);
    }
    if (res.status === 404) return { problem: problem("unreachable", `There's no public GitHub profile at github.com/${user}. Check the link.`, ["skip"]) };
    if (!res.ok) return unreachable(`GitHub answered ${res.status}. Try again in a while.`);
    const repos = ((await res.json()) as { name: string; fork?: boolean; language?: string | null }[]).filter((r) => !r.fork);
    const byLanguage = new Map<string, string[]>();
    for (const r of repos) if (r.language) byLanguage.set(r.language, [...(byLanguage.get(r.language) ?? []), r.name]);
    const pieces: Drafted[] = [...byLanguage]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([language, names]) => ({
        kind: "skill",
        text: language,
        quote: `${language}: ${names.length} public ${names.length === 1 ? "repository" : "repositories"} (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})`,
        entry: null,
        role: null,
      }));
    return { pieces, detail: `${repos.length} public ${repos.length === 1 ? "repository" : "repositories"}` };
  }

  async function readPortfolio(link: string): Promise<Read> {
    const unreachable = (message: string) => ({ problem: problem("unreachable", message, ["retry", "skip"]) });
    if (!deps.fetch) return unreachable("Links can't be read from here.");
    let html: string;
    try {
      const res = await deps.fetch(link, { headers: { accept: "text/html" } });
      if (!res.ok) return unreachable(`The site answered ${res.status}. Check the link, or try again later.`);
      html = await res.text();
    } catch (err) {
      return unreachable(`The site couldn't be reached: ${message(err)}.`);
    }
    const root = parseHtml(html);
    for (const el of root.querySelectorAll("script, style, noscript, svg, template")) el.remove();
    const text = root.structuredText.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    return text ? { text } : { problem: problem("empty", "There's no text on that page.", ["skip"]) };
  }

  /** Adds the drafted pieces as unconfirmed, merging each near-duplicate into the piece already there. */
  function save(item: ImportItem, drafted: Drafted[]) {
    const ids = new Map<number, string>();
    let pieces = 0;
    let merged = 0;
    const order = drafted.map((p, i) => [p, i] as const).sort(([a], [b]) => Number(!a.entry) - Number(!b.entry));
    for (const [p, i] of order) {
      const entry = p.kind === "role" || p.kind === "education" ? p.entry : null;
      const draft = { kind: p.kind, text: p.text.trim(), entry };
      const belongsTo = !entry && p.role !== null ? (ids.get(p.role) ?? null) : null;
      // Another source says it differently: the drafted piece already there waits for Kris to pick the true version.
      const rival = profile.all().find((existing) => existing.status !== "confirmed" && disagrees(draft, existing));
      if (rival) {
        ids.set(i, rival.id);
        profile.dispute(rival.id, { from: item.name, quote: p.quote, text: draft.text, entry });
        continue;
      }
      // A discarded piece stays discarded when another file repeats it.
      const twin = profile.everything().find((existing) => isNearDuplicate(draft, existing));
      if (twin) {
        ids.set(i, twin.id);
        merged++;
        const cited = [twin.source, ...twin.alsoFrom].some((s) => s.from === item.name && s.quote === p.quote);
        if (!cited) {
          db.prepare("INSERT INTO import_merge (import_id, item_id, piece_id, source_from, source_quote, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
            String(itemRow(item.id)!.import_id), item.id, twin.id, item.name, p.quote, draft.text || (entry ? `${entry.title}, ${entry.organisation}` : ""), now(),
          );
        }
        continue;
      }
      const saved = profile.save(
        { kind: p.kind, text: draft.text, entry, belongsTo },
        { from: item.name, quote: p.quote, status: "unconfirmed", checkThis: item.recognised },
      );
      if (!saved.saved) continue;
      ids.set(i, saved.piece.id);
      pieces++;
    }
    update(item.id, { state: "done", pieces, merged, finished_at: now() });
  }

  async function addFile(file: ImportFile) {
    const stored = await deps.files.put(file.bytes);
    return { sha256: stored.sha256, size: stored.size, type: fileTypeOf(file.fileName, file.bytes) };
  }

  return {
    async start(input) {
      const problems = check(input);
      if (problems.length > 0) return { started: false, problems };
      const id = `import:${crypto.randomUUID()}`;
      db.prepare("INSERT INTO import_run (id, started_at) VALUES (?, ?)").run(id, now());
      const sources: { source: ImportSource; name: string; type: ImportFileType; sha256: string | null; size: number | null }[] = [];
      for (const f of input.files ?? []) sources.push({ source: "file", name: f.fileName, ...(await addFile(f)) });
      if (input.linkedIn) sources.push({ source: "linkedin", name: input.linkedIn.fileName, ...(await addFile(input.linkedIn)), type: "zip" });
      if (input.github?.trim()) sources.push({ source: "github", name: `github.com/${GITHUB.exec(input.github.trim())![1]}`, type: "link", sha256: null, size: null });
      if (input.portfolio?.trim()) sources.push({ source: "portfolio", name: portfolioLink(input.portfolio)!, type: "link", sha256: null, size: null });
      const ids = sources.map((s, position) => {
        const itemId = `import-item:${crypto.randomUUID()}`;
        db.prepare("INSERT INTO import_item (id, import_id, position, source, name, type, sha256, size, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')")
          .run(itemId, id, position, s.source, s.name, s.type, s.sha256, s.size);
        return itemId;
      });
      return { started: true, ...enqueue(id, ids) };
    },

    status,

    cancel(id) {
      const run = db.prepare("SELECT id FROM import_run WHERE id = ?").get(id);
      if (!run) return null;
      control(id).cancelled = true;
      db.prepare("UPDATE import_run SET cancelled_at = ? WHERE id = ?").run(now(), id);
      db.prepare("UPDATE import_item SET state = 'cancelled' WHERE import_id = ? AND state = 'queued'").run(id);
      return status(id);
    },

    resume(id) {
      if (!db.prepare("SELECT id FROM import_run WHERE id = ?").get(id)) return null;
      control(id).cancelled = false;
      db.prepare("UPDATE import_run SET cancelled_at = NULL WHERE id = ?").run(id);
      const ids = db.prepare("SELECT id FROM import_item WHERE import_id = ? AND state IN ('waiting', 'cancelled') ORDER BY position").all(id).map((r) => String(r.id));
      return enqueue(id, ids);
    },

    async resolve(itemId, choice) {
      const row = itemRow(itemId);
      if (!row) return { resolved: false, message: "That file is no longer in the import." };
      const item = rowToItem(row);
      const runId = String(row.import_id);
      const allowed = item.problem?.options ?? [];
      if (!allowed.includes(choice.action)) return { resolved: false, message: "That isn't one of the choices for this file." };
      if (choice.action === "skip") {
        update(itemId, { state: "skipped", finished_at: now() });
        return { resolved: true, status: status(runId)!, done: Promise.resolve(status(runId)!) };
      }
      if (choice.action === "recognise") {
        if (!deps.recognizer) return { resolved: false, message: "Text recognition isn't available on this laptop." };
        update(itemId, { recognised: 1 });
      }
      if (choice.action === "text-version") {
        const type = fileTypeOf(choice.file.fileName, choice.file.bytes);
        if (item.source === "linkedin" ? type !== "zip" : !["pdf", "docx", "txt"].includes(type)) {
          return { resolved: false, message: item.source === "linkedin" ? "Choose the LinkedIn export's .zip file." : "Choose a PDF, DOCX or TXT file." };
        }
        const stored = await addFile(choice.file);
        const old = item.sha256;
        update(itemId, { name: choice.file.fileName, type: item.source === "linkedin" ? "zip" : stored.type, sha256: stored.sha256, size: stored.size, recognised: 0, text: null, detail: null });
        // The unreadable copy goes, unless something else still uses it.
        if (old && old !== stored.sha256 && !db.prepare("SELECT 1 AS x FROM import_item WHERE sha256 = ?").get(old)
          && !db.prepare("SELECT 1 AS x FROM profile_contact WHERE photo_sha256 = ?").get(old)) await deps.files.remove(old);
      }
      return { resolved: true, ...enqueue(runId, [itemId]) };
    },

    merges(id) {
      return db.prepare("SELECT m.*, p.id AS pid FROM import_merge m JOIN profile_piece p ON p.id = m.piece_id WHERE m.import_id = ? ORDER BY m.id").all(id)
        .flatMap((m) => {
          const piece = profile.get(String(m.pid));
          if (!piece) return [];
          return [{
            pieceId: piece.id,
            piece: piece.entry ? `${piece.entry.title}, ${piece.entry.organisation}` : piece.text,
            kept: piece.source,
            merged: { from: String(m.source_from), quote: m.source_quote == null ? null : String(m.source_quote), text: String(m.text) },
          }];
        });
    },
  };
}

function check(input: ImportInput): ImportInputProblem[] {
  const problems: ImportInputProblem[] = [];
  const any = (input.files?.length ?? 0) > 0 || input.linkedIn || input.github?.trim() || input.portfolio?.trim();
  if (!any) problems.push({ field: "files", message: "Add at least one file or link to import." });
  for (const f of input.files ?? []) {
    if (f.bytes.byteLength === 0) problems.push({ field: "files", message: `${f.fileName} is empty.` });
  }
  if (input.linkedIn && !/\.zip$/i.test(input.linkedIn.fileName)) {
    problems.push({ field: "linkedIn", message: "Choose the .zip file LinkedIn emailed you." });
  }
  if (input.github?.trim() && !GITHUB.test(input.github.trim())) {
    problems.push({ field: "github", message: "Give your GitHub profile's link, like github.com/your-name." });
  }
  if (input.portfolio?.trim() && !portfolioLink(input.portfolio)) {
    problems.push({ field: "portfolio", message: "Give the site's full link, like https://your-name.dev." });
  }
  return problems;
}

/** The portfolio's link with https:// added when it has no scheme; null when it isn't a web link. */
function portfolioLink(link: string): string | null {
  const s = link.trim();
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
