// Applications (hi-fi: docs/design/hifi/applications.html, states Normal, One application, No
// applications and Add application): the page head with Add application, the first-run empty state,
// and every Application grouped by Status. Interviewing, Screening, Offer and Applied start open;
// Closed starts collapsed and is never deleted. Each row has a labelled Status select: a change is an
// Event "by you" with a 10-second (or longer) undo toast. A row's title opens its Application page.
// The Stats strip sits above (StatsStrip.tsx), then Needs you (NeedsYou.tsx): emails to match
// (EmailsToMatch.tsx) and follow-ups due, written in a dialog over the list. Each row's Next says what
// comes next. The job mailbox's state shows as a banner and in the page-head line (MailState.tsx).
// At scale (hi-fi state "214 applications"): search across job, company, contacts and matched email
// text; Status chips with counts that follow the search and filters, angle and date selects; the
// active filters named in one line with one Clear; groups over 25 rows paged inside the group
// ("Applied 1–25 of 47") so headers stay put. "Since your last visit" lists the Status changes email
// made, each linking to its Application (T-12). A mailbox read never moves rows under the user: when
// it changes what's shown, a quiet line offers the update instead.
import type {
  Angle, ApplicationGroup, ApplicationList, ApplicationSummary, EmailToMatch, FollowUp, GroupKey, HealthSummary, NeedsYou, NeedsYouEntry, PackageConfirmation, SinceLastVisit,
  Status, StatusFilter, TrackMailbox,
} from "@apply-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  acceptOffer, answerPackageConfirmation, undoPackageConfirmation, fetchApplicationList, fetchEmailsToMatch, fetchNeedsYou, fetchSources, fetchTrackMailbox, followUpAction, needsYouChanged,
  setApplicationStatus, undoApplicationEvent, visitApplications, type ApplicationListParams,
} from "../api.ts";
import { useToaster } from "../feed/toast.tsx";
import { Chevron } from "../icons.tsx";
import { AddApplicationDialog, type Added } from "./AddApplicationDialog.tsx";
import { EmailToMatchItems } from "./EmailsToMatch.tsx";
import type { FollowUpAction } from "./FollowUpWriter.tsx";
import { MailboxBanner, mailWords, useMailReading } from "./MailState.tsx";
import { FollowUpDialog, itemId, NeedsYouSection, PackageConfirmationItems } from "./NeedsYou.tsx";
import { StatsStrip } from "./StatsStrip.tsx";
import { WithdrawDialog } from "./Withdrawals.tsx";
import { angleLabel, daysWord, dueWords, eventTime, followUpName, nextWords, shortDay, statusLabel, statusOrder, todaySofia, weekDay } from "./words.ts";

/** Groups over this many rows are paged (the service's page size). */
const pageSize = 25;
/** From this many Applications on, the Status chips show. */
const chipsFrom = 26;

interface Filters { q: string; status: StatusFilter | null; angle: Angle | null; within: number | null }
const noFilters: Filters = { q: "", status: null, angle: null, within: null };
const isFiltered = (f: Filters) => !!(f.q.trim() || f.status || f.angle || f.within);
const groupLabels: Record<GroupKey, string> = { accepted: "Accepted", offer: "Offer", interviewing: "Interviewing", screening: "Screening", applied: "Applied", closed: "Closed" };
const chipOrder: GroupKey[] = ["accepted", "offer", "interviewing", "screening", "applied", "closed"];
const groupCount = (counts: Record<Status, number>, k: GroupKey) => (k === "closed" ? counts.rejected + counts.withdrawn : counts[k]);

/** What's shown, to tell whether a mailbox read would move rows under the user. */
const shownKey = (list: ApplicationList, needs: NeedsYou | null) =>
  JSON.stringify([list.groups.map((g) => [g.key, g.count, g.applications.map((a) => [a.id, a.status])]), needs?.items.map((i) => [i.followUp.id, i.done]), needs?.count]);

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; list: ApplicationList };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const named = (a: ApplicationSummary) => `${a.title} at ${a.company}`;
const selectId = (id: string) => `st-${id}`;
const rowId = (id: string) => `app-${id}`;
/** Bulgarian titles are marked as such, so screen readers read them in Bulgarian. */
const langOf = (text: string) => (/[Ѐ-ӿ]/.test(text) ? "bg" : undefined);
/** Groups that show 5 until asked for the rest. */
const limited: GroupKey[] = ["applied", "closed"];

export function ApplicationsPage({ onHealth }: { onHealth: (h: HealthSummary) => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [all, setAll] = useState<GroupKey[]>([]);
  const [expanded, setExpanded] = useState<Partial<Record<GroupKey, boolean>>>({});
  const [adding, setAdding] = useState(false);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [needs, setNeeds] = useState<NeedsYou | null>(null);
  const [writing, setWriting] = useState<{ entries: NeedsYouEntry[]; index: number; opener: HTMLElement } | null>(null);
  /** The offer just accepted (from a row's Status select): the withdrawal dialog is open over the list, with its accept to undo. */
  const [withdrawing, setWithdrawing] = useState<{ app: ApplicationSummary; from: Status; eventId: string } | null>(null);
  const [filters, setFilters] = useState<Filters>(noFilters);
  /** The search box as typed; the list follows it a moment after the last key. */
  const [typed, setTyped] = useState("");
  /** Where each paged group starts. */
  const [at, setAt] = useState<Partial<Record<GroupKey, number>>>({});
  const [visit, setVisit] = useState<SinceLastVisit | null>(null);
  /** What a mailbox read changed, held so rows don't move under the user until they ask. */
  const [held, setHeld] = useState<{ list: ApplicationList; needs: NeedsYou } | null>(null);
  const params = useMemo<ApplicationListParams>(() => ({ all, paged: true, at, ...filters }), [all, at, filters]);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the next list has rendered (the button it targets may be a new one). */
  const focusNext = useRef<(() => void) | null>(null);
  const toaster = useToaster();
  const [emails, setEmails] = useState<EmailToMatch[]>([]);
  const [mailbox, setMailbox] = useState<TrackMailbox | null>(null);
  /** When the list shown was loaded ("The list below is from 07:30"). */
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());

  /** Needs you's emails and the mailbox's state; a failure leaves what's shown. */
  const refreshMail = useCallback(async () => {
    const [e, m] = await Promise.all([fetchEmailsToMatch(), fetchTrackMailbox()]);
    setEmails(e);
    setMailbox(m);
  }, []);

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    f?.();
  }, [load]);

  useEffect(() => { document.title = "Applications · apply-kit"; }, []);

  // The top bar shows source health on every screen.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth]);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchApplicationList(params, ctrl.signal), fetchNeedsYou(ctrl.signal)])
      .then(([list, n]) => { setNeeds(n); setHeld(null); setLoad({ state: "ready", list }); setLoadedAt(new Date().toISOString()); })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: message(err) }); });
    return () => ctrl.abort();
  }, [params, attempt]);

  // The search follows typing a moment after the last key; a new search starts every group at its first page.
  useEffect(() => {
    if (typed === filters.q) return;
    const t = window.setTimeout(() => { setFilters((f) => ({ ...f, q: typed })); setAt({}); }, 250);
    return () => window.clearTimeout(t);
  }, [typed, filters.q]);

  // "Since your last visit": recorded once per arrival (opening the page again within 30 minutes is the same visit).
  useEffect(() => { visitApplications().then(setVisit).catch(() => {}); }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchEmailsToMatch(ctrl.signal), fetchTrackMailbox(ctrl.signal)])
      .then(([e, m]) => { setEmails(e); setMailbox(m); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [attempt]);

  /** Loads the list and Needs you again; the top bar's badge counts again too. */
  const refresh = useCallback(async (show: GroupKey[] = all) => {
    const [list, n] = await Promise.all([fetchApplicationList({ ...params, all: show }), fetchNeedsYou()]);
    setNeeds(n);
    setHeld(null);
    setLoad({ state: "ready", list });
    setLoadedAt(new Date().toISOString());
    refreshMail().catch(() => {});
    needsYouChanged();
    return list;
  }, [all, params, refreshMail]);

  // A check reading the job mailbox: one quiet line meanwhile. Then the list and Needs you are read
  // again; when that would move what's shown, it is held behind "Show the update" instead.
  const shown = useRef<string>("");
  useEffect(() => { if (load.state === "ready") shown.current = shownKey(load.list, needs); }, [load, needs]);
  const reading = useMailReading(useCallback(() => {
    refreshMail().catch(() => {});
    needsYouChanged();
    Promise.all([fetchApplicationList(params), fetchNeedsYou()])
      .then(([list, n]) => {
        if (shownKey(list, n) === shown.current) { setLoad({ state: "ready", list }); setNeeds(n); setLoadedAt(new Date().toISOString()); }
        else setHeld({ list, needs: n });
      })
      .catch(() => {});
  }, [params, refreshMail]));

  /** Moves focus to an Application's Status select, or to its group's heading when its row isn't shown. */
  const focusApplication = useCallback((id: string, group?: GroupKey) => {
    requestAnimationFrame(() => {
      const select = document.getElementById(selectId(id));
      if (select && select.offsetParent !== null) select.focus();
      else if (group) document.getElementById(`g-${group}-h`)?.focus();
    });
  }, []);

  /** Shows one Application (a link to it, or one that already exists): its group opened in full, its row marked. */
  const reveal = useCallback(async (id: string) => {
    // Shown in full, without search or filters; in a paged group, on the page that holds it.
    const show = [...new Set([...all, ...limited])];
    const offsets: Partial<Record<GroupKey, number>> = {};
    const fetchWith = () => fetchApplicationList({ all: show, paged: true, at: { ...offsets } });
    let list = await fetchWith();
    for (const g of list.groups) {
      if (g.count <= pageSize || list.groups.some((x) => x.applications.some((a) => a.id === id))) continue;
      for (let o = pageSize; o < g.count; o += pageSize) {
        offsets[g.key] = o;
        list = await fetchWith();
        if (list.groups.find((x) => x.key === g.key)?.applications.some((a) => a.id === id)) break;
        delete offsets[g.key];
      }
    }
    setTyped("");
    setFilters(noFilters);
    setAt(offsets);
    setAll(show);
    setLoad({ state: "ready", list });
    const group = list.groups.find((g) => g.applications.some((a) => a.id === id));
    if (!group) return;
    setExpanded((e) => ({ ...e, [group.key]: true }));
    setHighlight(id);
    requestAnimationFrame(() => {
      document.getElementById(rowId(id))?.scrollIntoView({ block: "center" });
      focusApplication(id, group.key);
    });
  }, [all, focusApplication]);

  // An older link to one Application in the list (#app-<id>): revealed and highlighted there.
  useEffect(() => {
    const fromHash = () => {
      const m = /^#app-(.+)$/.exec(window.location.hash);
      if (m) reveal(decodeURIComponent(m[1]!)).catch(() => {});
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // Only on arrival and on later hash changes, not each time `reveal` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupOf = (list: ApplicationList, id: string) => list.groups.find((g) => g.applications.some((a) => a.id === id))?.key;

  /** Applies a Status change; resolves false when it was refused (the list then shows the Status the service has). */
  async function changeStatus(app: ApplicationSummary, to: Status): Promise<boolean> {
    if (to === "accepted") return accept(app);
    try {
      const { event, cancelled } = await setApplicationStatus(app.id, to);
      const list = await refresh();
      const group = groupOf(list, app.id) ?? (to === "rejected" || to === "withdrawn" ? "closed" : (to as GroupKey));
      focusApplication(app.id, group);
      toaster.show({
        message: `${app.company}: ${statusLabel[app.status]} → ${statusLabel[to]}. Logged by you.${cancelledWords(cancelled)}`,
        returnFocus: () => focusApplication(app.id, group),
        undo: () => {
          undoApplicationEvent(event.id)
            .then(() => refresh())
            .then((after) => {
              focusApplication(app.id, groupOf(after, app.id));
              toaster.announce(`Undone. Back to ${statusLabel[app.status]}.`);
            })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
      return true;
    } catch (err) {
      await refresh().catch(() => {});
      focusApplication(app.id);
      toaster.show({ message: `Couldn't change the Status: ${message(err)}` });
      return false;
    }
  }

  /**
   * "Mark Applied, dated …?": marks the package's Application Applied on the email's day (with Undo),
   * or leaves the email to match by hand. Focus goes to the new row, or back to Needs you.
   */
  async function answerPackage(item: PackageConfirmation, answer: "mark-applied" | "not-this") {
    const job = `${item.package.job.title} · ${item.package.job.company}`;
    const toNeeds = () => requestAnimationFrame(() => document.getElementById("ny-h")?.focus());
    try {
      const r = await answerPackageConfirmation(item.email.id, answer);
      const list = await refresh();
      if (answer === "not-this" || !r.application) {
        toNeeds();
        toaster.announce("Not this package: nothing was added. The email waits under Needs you for you to match.");
        return;
      }
      const id = r.application.id;
      focusApplication(id, groupOf(list, id));
      toaster.show({
        message: `${job}: marked Applied, dated ${weekDay(item.appliedOn)}. Logged by you.`,
        returnFocus: () => focusApplication(id, groupOf(list, id)),
        undo: () => {
          undoPackageConfirmation(item.email.id).then(() => refresh())
            .then(() => { toNeeds(); toaster.announce("Undone. Nothing is marked Applied; the question is back in Needs you."); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
    } catch (err) {
      await refresh().catch(() => {});
      toNeeds();
      toaster.show({ message: `Couldn't mark it Applied: ${message(err)}` });
    }
  }

  /** Accepted in a row's select: the accept flow, never a silent change. The withdrawal dialog opens over the list. */
  async function accept(app: ApplicationSummary): Promise<boolean> {
    try {
      const { event } = await acceptOffer(app.id);
      await refresh();
      setWithdrawing({ app, from: app.status, eventId: event.id });
      return true;
    } catch (err) {
      await refresh().catch(() => {});
      focusApplication(app.id);
      toaster.show({ message: `Couldn't accept the offer: ${message(err)}` });
      return false;
    }
  }

  /** The withdrawal dialog closed: focus back to the row's Status, and the accept itself can be undone. */
  function withdrawn() {
    const w = withdrawing!;
    setWithdrawing(null);
    focusApplication(w.app.id, "accepted");
    toaster.show({
      message: `${w.app.company}: ${statusLabel[w.from]} → Accepted. Logged by you.`,
      returnFocus: () => focusApplication(w.app.id, "accepted"),
      undo: () => {
        undoApplicationEvent(w.eventId)
          .then(() => refresh())
          .then((after) => { focusApplication(w.app.id, groupOf(after, w.app.id)); toaster.announce(`Undone. Back to ${statusLabel[w.from]}; no withdrawals to send.`); })
          .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
      },
    });
  }

  /** Mark sent, skip or snooze a follow-up (from Needs you or its dialog), with Undo in the toast. */
  async function actOn(entry: NeedsYouEntry, action: FollowUpAction) {
    const { application: a, followUp: f } = entry;
    const name = `${a.company} ${followUpName(f.kind).toLowerCase()}`;
    try {
      const { event, followUp } = await followUpAction(f.id, action);
      // Written one by one from a group: on to the next one; otherwise the dialog closes.
      const advance = writing && writing.entries.length > 1 && writing.index < writing.entries.length - 1;
      setWriting((w) => (advance && w ? { ...w, index: w.index + 1 } : null));
      await refresh();
      // Sent or skipped, it stays in place as done; snoozed, it leaves Needs you.
      const focusAfter = () => requestAnimationFrame(() => {
        const link = document.querySelector<HTMLElement>(`#${CSS.escape(itemId(f.id))} a`);
        (action === "snooze" || !link ? document.getElementById("ny-h") : link)?.focus();
      });
      if (!advance) focusAfter();
      toaster.show({
        message: f.kind === "withdrawal"
          ? (action === "sent" ? `${a.company}: ${statusLabel[a.status]} → Withdrawn. Logged by you.` : `Kept open · no withdrawal for ${a.company}.`)
          : action === "sent"
          ? `Marked ${f.kind === "nudge" ? "sent" : "done"} · ${name} logged on its timeline.`
          : action === "skip" ? `Skipped · no ${followUpName(f.kind).toLowerCase()} for ${a.company} this time.`
          : `Snoozed · ${name} due again ${weekDay(followUp.dueOn)}.`,
        returnFocus: advance ? undefined : focusAfter,
        undo: () => {
          undoApplicationEvent(event.id)
            .then(() => refresh())
            .then(() => { if (!advance) focusAfter(); toaster.announce(`Undone: the ${name} is ${dueWords(f.dueOn)} again.`); })
            .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
        },
      });
    } catch (err) {
      await refresh().catch(() => {});
      toaster.show({ message: `Couldn't change the follow-up: ${message(err)}` });
    }
  }

  /** "Snooze all": every follow-up of a group, with one Undo for all of them. */
  async function snoozeAll(entries: NeedsYouEntry[]) {
    const done: string[] = [];
    try {
      for (const e of entries) done.push((await followUpAction(e.followUp.id, "snooze")).event.id);
    } catch (err) {
      toaster.show({ message: `Couldn't snooze them all: ${message(err)}` });
    }
    await refresh().catch(() => {});
    const focus = () => requestAnimationFrame(() => document.getElementById("ny-h")?.focus());
    focus();
    if (!done.length) return;
    const kind = followUpName(entries[0]!.followUp.kind).toLowerCase();
    toaster.show({
      message: `Snoozed ${done.length} · each ${kind} comes due again in ${daysWord(needs?.snoozeDays ?? 3)}.`,
      returnFocus: focus,
      undo: () => {
        Promise.all(done.map((id) => undoApplicationEvent(id)))
          .then(() => refresh())
          .then(() => { focus(); toaster.announce(`Undone: ${done.length} are due again.`); })
          .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
      },
    });
  }

  function added(result: Added) {
    setAdding(false);
    setLinkProblem(result.linkProblem);
    const a = result.application;
    refresh()
      .then((list) => {
        const group = groupOf(list, a.id);
        if (group) focusApplication(a.id, group);
        else addRef.current?.focus();
      })
      .catch(() => addRef.current?.focus());
    toaster.show({
      message: `Added · ${named(a)}, ${statusLabel[a.status]} ${shortDay(a.appliedOn)}.`,
      returnFocus: () => (document.getElementById(selectId(a.id)) ?? addRef.current)?.focus(),
      undo: () => {
        undoApplicationEvent(result.event.id)
          .then(() => { focusNext.current = () => addRef.current?.focus(); return refresh(); })
          .then(() => { setLinkProblem(null); toaster.announce("Removed again."); })
          .catch((err: unknown) => toaster.show({ message: `Couldn't undo: ${message(err)}` }));
      },
    });
  }

  const followUpDialog = writing && (
    <FollowUpDialog
      entries={writing.entries}
      index={writing.index}
      onAct={(action) => { actOn(writing.entries[writing.index]!, action).catch(() => {}); }}
      onNext={() => setWriting({ ...writing, index: Math.min(writing.index + 1, writing.entries.length - 1) })}
      onClose={() => { const o = writing.opener; setWriting(null); requestAnimationFrame(() => (o.isConnected ? o : document.getElementById("ny-h"))?.focus()); }}
      onAnnounce={toaster.announce}
    />
  );

  const dialog = adding && (
    <AddApplicationDialog
      onAdded={added}
      onCancel={() => { setAdding(false); addRef.current?.focus(); }}
      onOpenExisting={(a) => { setAdding(false); reveal(a.id).catch(() => {}); }}
    />
  );

  if (load.state === "loading") return <p className="meta" role="status">Loading applications…</p>;
  if (load.state === "error") {
    return (
      <div className="banner error" role="alert">
        <span className="text"><b>Couldn't reach the apply-kit service.</b> {load.message}. Check that it is running, then try again.</span>
        <button className="btn sm" type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
      </div>
    );
  }

  const { list } = load;

  /** Changes the filters: every group starts again at its first page. */
  const filter = (f: Partial<Filters>) => { setFilters((x) => ({ ...x, ...f })); setAt({}); };
  const clear = () => { setTyped(""); setFilters(noFilters); setAt({}); requestAnimationFrame(() => document.getElementById("apps-q")?.focus()); };
  /** Moves a paged group to the page starting at `offset`; focus goes to its first row. */
  const page = (g: ApplicationGroup, offset: number) => {
    setAt((a) => ({ ...a, [g.key]: offset }));
    toaster.announce(`${g.label} ${offset + 1}–${Math.min(offset + pageSize, g.count)} of ${g.count}.`);
    const wait = (tries: number) => requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(`#g-${g.key} tbody tr select`);
      const row = first?.closest("tr");
      if (first && row && row.dataset.offset === String(offset)) first.focus();
      else if (tries > 0) setTimeout(() => wait(tries - 1), 50);
    });
    wait(40);
  };

  if (list.total === 0) {
    return (
      <>
        {(mailbox?.state === "failing" || mailbox?.state === "not-connected" || emails.length > 0 || !!needs?.packageConfirmations.length) && (
          <div className="stack" style={{ gap: "var(--s-7)", marginBottom: "var(--s-7)" }}>
            <MailboxBanner mailbox={mailbox} />
            {(emails.length > 0 || !!needs?.packageConfirmations.length) && (
              <section className="stack" style={{ gap: "var(--s-4)" }} aria-labelledby="ny-h">
                <div className="sec-head"><h2 id="ny-h" tabIndex={-1}>Needs you · {emails.length + (needs?.packageConfirmations.length ?? 0)}</h2></div>
                <ul className="needs-queue">
                  <EmailToMatchItems emails={emails} total={0} toaster={toaster} onAnswered={() => refresh()} />
                  <PackageConfirmationItems items={needs?.packageConfirmations ?? []} onAnswer={(item, answer) => { answerPackage(item, answer).catch(() => {}); }} />
                </ul>
              </section>
            )}
          </div>
        )}
        <div className="empty">
          <svg viewBox="0 0 120 48" width="120" height="48" aria-hidden="true"><path d="M2 46 32 12l18 20 14-14 26 28z" fill="var(--met-soft)" stroke="var(--action)" strokeWidth="2" strokeLinejoin="round" /><circle cx="96" cy="10" r="5" fill="var(--bloom)" /></svg>
          <h1>No applications yet</h1>
          <p>
            An Application appears here when you press <b>I applied without apply-kit…</b> on a Job, or add one by hand.
            Once packages arrive, marking one submitted adds it too. Each Application keeps its Status, and every change is logged with who made it.
          </p>
          <div className="row">
            <a className="btn primary" href="/">Find a job in the Feed</a>
            <button className="btn" type="button" ref={addRef} onClick={() => setAdding(true)}>Add an application from before</button>
          </div>
          <p className="meta">Applied somewhere before apply-kit? Add it so it's tracked with the rest.</p>
        </div>
        {dialog}
        {toaster.element}
      </>
    );
  }

  const mailLine = mailWords(mailbox);
  const isOpen = (g: ApplicationGroup) => expanded[g.key] ?? g.open;
  const toggle = (g: ApplicationGroup) => setExpanded((e) => ({ ...e, [g.key]: !isOpen(g) }));
  const showMore = (g: ApplicationGroup) => {
    const shown = g.applications.length;
    setAll((a) => [...new Set([...a, g.key])]);
    toaster.announce(`${g.count - shown} more ${g.label} applications shown.`);
    // Focus the first row that was hidden, once it's there.
    const wait = (tries: number) => requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLElement>(`#g-${g.key} tbody tr`);
      const next = rows[shown]?.querySelector<HTMLElement>("select");
      if (next) next.focus();
      else if (tries > 0) setTimeout(() => wait(tries - 1), 50);
    });
    wait(40);
  };

  return (
    <section className="stack" style={{ gap: "var(--s-7)" }}>
      {mailbox?.state === "failing" && <MailboxBanner mailbox={mailbox} />}
      <div className="page-head">
        <div className="lead">
          <h1>Applications</h1>
          {reading ? (
            <p className="meta" role="status"><span className="spin sm" aria-hidden="true" /> Reading the job mailbox for replies… The list below is from {eventTime(loadedAt).replace(/^today /, "")} and stays usable.</p>
          ) : (
            <p className="meta">{list.total} since {list.since ? shortDay(list.since) : "today"} · {list.open} open{mailLine && ` · ${mailLine}`}</p>
          )}
        </div>
        <span className="grow" />
        <button className="btn" type="button" ref={addRef} onClick={() => setAdding(true)}>Add application</button>
      </div>

      {linkProblem && (
        <div className="banner warning">
          <span className="text">{linkProblem}</span>
          <button className="btn sm" type="button" onClick={() => { setLinkProblem(null); addRef.current?.focus(); }}>Dismiss</button>
        </div>
      )}

      {mailbox?.state === "not-connected" && <MailboxBanner mailbox={mailbox} />}

      <StatsStrip version={list} mailbox={mailbox} />

      {visit && visit.changes.length > 0 && <SinceVisit visit={visit} />}

      {list.total === 1 && !needs?.items.length && !needs?.offers.length && !needs?.packageConfirmations.length && emails.length === 0 ? (
        <div className="calm">
          <h2 className="sr-only">Needs you</h2>
          <h3>Nothing needs you yet</h3>
          <p className="muted">
            Your first Application is in. Change its Status from the list whenever you hear back; every change is logged and can be undone.
            {needs?.comingUp[0] && ` Its follow-up comes due ${weekDay(needs.comingUp[0].dueOn)} if there's no reply.`}
          </p>
        </div>
      ) : needs && (
        <NeedsYouSection
          needs={needs} onWrite={(entry, opener) => setWriting({ entries: [entry], index: 0, opener })} onSnooze={(e) => { actOn(e, "snooze").catch(() => {}); }}
          onReview={(entries, opener) => setWriting({ entries, index: 0, opener })} onSnoozeAll={(entries) => { snoozeAll(entries).catch(() => {}); }}
          onPackage={(item, answer) => { answerPackage(item, answer).catch(() => {}); }}
          emails={<EmailToMatchItems emails={emails} total={list.total} toaster={toaster} onAnswered={() => refresh()} />}
        />
      )}

      <section className="panel flush" aria-labelledby="apps-h">
        <div className="sec-head"><h2 id="apps-h">All applications · {list.total}</h2></div>
        {held && (
          <p className="held" role="status">
            <span>New mail changed what's shown here. The list stays as it is until you're ready.</span>
            <button className="btn sm" type="button" onClick={() => { const h = held; setHeld(null); setNeeds(h.needs); setLoad({ state: "ready", list: h.list }); setLoadedAt(new Date().toISOString()); toaster.announce("Updated with the new mail."); }}>
              Show the update
            </button>
          </p>
        )}
        {list.total > 1 && (
          <div className="list-tools">
            <div className="toolbar">
              <div className="search">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                <input
                  className="input" id="apps-q" type="search" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)}
                  placeholder="Search job, company, contact or email…" aria-label="Search applications"
                />
              </div>
              {(list.total >= chipsFrom || filters.status) && (
                <div className="chips" role="group" aria-label="Status filter">
                  {(["open", ...chipOrder] as StatusFilter[]).map((k) => {
                    const n = k === "open" ? statusOrder.filter((s) => s !== "rejected" && s !== "withdrawn").reduce((a, s) => a + list.counts[s], 0) : groupCount(list.counts, k);
                    if (k !== "open" && !n && filters.status !== k) return null;
                    const on = filters.status === k;
                    return (
                      <button key={k} className="filter" type="button" aria-pressed={on} onClick={() => filter({ status: on ? null : k })}>
                        {k === "open" ? "Open" : groupLabels[k]} <span className="n">{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="end">
                <label className="sr-only" htmlFor="apps-angle">Angle</label>
                <select className="input" id="apps-angle" value={filters.angle ?? ""} onChange={(e) => filter({ angle: (e.target.value || null) as Angle | null })}>
                  <option value="">All angles</option>
                  {(Object.keys(angleLabel) as Angle[]).map((a) => <option key={a} value={a}>{angleLabel[a]}</option>)}
                </select>
                <label className="sr-only" htmlFor="apps-within">Applied</label>
                <select className="input" id="apps-within" value={filters.within ?? ""} onChange={(e) => filter({ within: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Any time</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
              </div>
            </div>
            {isFiltered(filters) && (
              <p className="active-filters" aria-live="polite">
                <span>{activeWords(filters, list.matching)}</span>
                <button className="btn sm" type="button" onClick={clear}>Clear</button>
              </p>
            )}
          </div>
        )}
        <div className="groups">
          {list.groups.map((g) => (
            <Group
              key={g.key} group={g} list={list} open={isOpen(g)} highlight={highlight}
              onToggle={() => toggle(g)} onMore={() => showMore(g)} onPage={(offset) => page(g, offset)} onStatus={changeStatus}
            />
          ))}
          {list.groups.length === 0 && (
            <div className="calm none-match">
              <h3>No applications match</h3>
              <p className="muted">Nothing matches the search and filters above. Clear them to see all {list.total}.</p>
              <button className="btn" type="button" onClick={clear}>Clear search and filters</button>
            </div>
          )}
        </div>
      </section>
      {dialog}
      {followUpDialog}
      {withdrawing && <WithdrawDialog accepted={withdrawing.app} onChanged={() => refresh()} onClose={withdrawn} />}
      {toaster.element}
    </section>
  );
}

/** The active filters named in one line ("Showing open applications · matching “nimbus” · 14 match"). */
function activeWords(f: Filters, matching: number): string {
  const parts = [
    f.status === "open" ? "Showing open applications" : f.status ? `Showing ${groupLabels[f.status]}` : "Showing every Status",
    f.q.trim() && `matching “${f.q.trim()}”`,
    f.angle && `${angleLabel[f.angle]} angle`,
    f.within && `applied in the last ${f.within} days`,
    `${matching} ${matching === 1 ? "matches" : "match"}`,
    "counts follow the search and filters",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** "Since yesterday", "Since today 08:40", "Since Mon 12 Oct". */
function sinceWords(iso: string): string {
  const day = todaySofia(new Date(iso));
  const today = todaySofia();
  const yesterday = todaySofia(new Date(Date.now() - 86_400_000));
  if (day === today) return `Since ${eventTime(iso)}`;
  if (day === yesterday) return "Since yesterday";
  return `Since ${weekDay(day)}`;
}

/** "Since your last visit": one quiet line of the Status changes email made, each linking to its Application. No queue item: nothing needs the user. */
function SinceVisit({ visit }: { visit: SinceLastVisit }) {
  return (
    <p className="since-visit">
      <b>{sinceWords(visit.since!)}:</b>{" "}
      {visit.changes.map((c, i) => (
        <span key={c.eventId}>
          {i > 0 && " · "}
          <a href={`/applications/${encodeURIComponent(c.applicationId)}`}>{c.company}</a>
          {" "}<span className="sr-only">(<span lang={langOf(c.title)}>{c.title}</span>) </span>
          moved to {statusLabel[c.to]} by email
        </span>
      ))}
    </p>
  );
}

/** What a Status change did to a pending follow-up, for its toast. */
function cancelledWords(f: FollowUp | null): string {
  if (!f) return "";
  return ` The ${followUpName(f.kind).toLowerCase()} ${f.dueOn <= todaySofia() ? "that was due" : `due ${weekDay(f.dueOn)}`} is cancelled; Undo brings it back.`;
}

function Group({ group: g, list, open, highlight, onToggle, onMore, onPage, onStatus }: {
  group: ApplicationGroup;
  list: ApplicationList;
  open: boolean;
  highlight: string | null;
  onToggle: () => void;
  onMore: () => void;
  onPage: (offset: number) => void;
  onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean>;
}) {
  const hint = g.key === "closed"
    ? `${list.counts.rejected} rejected · ${list.counts.withdrawn} withdrawn · never deleted`
    : g.order;
  const paged = g.count > pageSize;
  const hidden = paged ? 0 : g.count - g.applications.length;
  const end = g.offset + g.applications.length;
  return (
    <div className="app-group">
      <div className="group-h">
        <h3>
          <button className="disclose" id={`g-${g.key}-h`} type="button" aria-expanded={open} aria-controls={`g-${g.key}`} onClick={onToggle}>
            <Chevron />{g.label} <span className="count">{g.count}</span>
          </button>
        </h3>
        {hint && <span className="meta">{hint}</span>}
      </div>
      <div id={`g-${g.key}`} hidden={!open}>
        <div className="table-wrap">
          <table className="table apps" aria-label={`${g.label} applications`}>
            <colgroup>
              <col className="c-job" /><col className="c-status" /><col className="c-date wide" /><col className="c-last wide" /><col className="c-next wide" /><col className="c-angle wide" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Job</th><th scope="col">Status</th><th scope="col" className="wide">Applied</th>
                <th scope="col" className="wide">Last event</th><th scope="col" className="wide">Next</th><th scope="col" className="wide">Angle</th>
              </tr>
            </thead>
            <tbody>
              {g.applications.map((a) => <Row key={a.id} app={a} offset={g.offset} highlighted={a.id === highlight} onStatus={onStatus} />)}
            </tbody>
          </table>
        </div>
        {paged && (
          <div className="group-foot">
            <span>{g.label} {g.offset + 1}–{end} of {g.count}</span>
            <button
              className="btn sm" type="button" aria-disabled={g.offset === 0 || undefined}
              onClick={() => { if (g.offset > 0) onPage(Math.max(0, g.offset - pageSize)); }}
            >Previous<span className="sr-only"> {g.label}</span></button>
            <button
              className="btn sm" type="button" aria-disabled={end >= g.count || undefined}
              onClick={() => { if (end < g.count) onPage(end); }}
            >{end < g.count ? `Next ${Math.min(pageSize, g.count - end)}` : "Next"}<span className="sr-only"> {g.label}</span></button>
          </div>
        )}
        {hidden > 0 && (
          <div className="group-foot">
            Showing {g.applications.length} of {g.count}
            <button className="btn sm" type="button" onClick={onMore}>Show {hidden} more</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ app: a, offset, highlighted, onStatus }: { app: ApplicationSummary; offset: number; highlighted: boolean; onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean> }) {
  const closed = a.status === "rejected" || a.status === "withdrawn";
  const last = `${a.lastEvent.text} · ${eventTime(a.lastEvent.at)}`;
  const lang = langOf(a.title);
  const next = nextWords(a.next);
  return (
    <tr id={rowId(a.id)} data-offset={offset} className={[closed && "closed", highlighted && "is-focused"].filter(Boolean).join(" ") || undefined}>
      <td>
        <a className="t" href={`/applications/${encodeURIComponent(a.id)}`} lang={lang}>{a.title}</a>
        <span className="co">{a.company}</span>
        <span className="narrow">Applied {shortDay(a.appliedOn)} · {next?.text ?? last}</span>
      </td>
      <td><StatusSelect key={a.status} app={a} onStatus={onStatus} /></td>
      <td className="wide num">{shortDay(a.appliedOn)}</td>
      <td className="wide"><div className="last">{last}</div><By cause={a.lastEvent.cause} /></td>
      <td className={`wide next${next?.due ? " due" : ""}`}>{next?.due && <span aria-hidden="true">● </span>}{next?.text ?? "—"}</td>
      <td className="wide meta">{a.angle ? angleLabel[a.angle] : "—"}</td>
    </tr>
  );
}

const pickKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

/**
 * The row's quick Status change. Picked with the pointer from the open list, it applies at once.
 * Arrowing through the closed select (which fires `change` on some platforms) only moves the choice;
 * it applies on Enter or when focus leaves, so passing through Statuses never logs each one (TA-09).
 * Accepted opens the accept flow (moves it to Accepted and offers to withdraw the others). Keyed by the
 * Status, so a new Status from the service starts it afresh. Its label is visually hidden unless
 * `label` is given (the Application page shows "Status" beside its stepper).
 */
export function StatusSelect({ app, onStatus, label }: {
  app: ApplicationSummary;
  onStatus: (a: ApplicationSummary, to: Status) => Promise<boolean>;
  label?: string;
}) {
  const [value, setValue] = useState<Status>(app.status);
  const keyed = useRef(false);
  const sent = useRef<Status | null>(null);

  const commit = (to: Status) => {
    keyed.current = false;
    if (to === app.status || to === sent.current) return;
    sent.current = to;
    onStatus(app, to).then((ok) => {
      // Refused: the select goes back to the Status it has. (Applied, the select is made afresh for the new Status.)
      if (!ok) { sent.current = null; setValue(app.status); }
    }).catch(() => {});
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(value); return; }
    if (e.key === "Escape") { keyed.current = false; setValue(app.status); return; }
    if (pickKeys.has(e.key) || e.key.length === 1) keyed.current = true;
  };

  return (
    <>
      <label className={label ? undefined : "sr-only"} htmlFor={selectId(app.id)}>{label ?? `Status of ${app.title} at ${app.company}`}</label>
      <select
        className="input" id={selectId(app.id)} value={value} onKeyDown={onKeyDown}
        onChange={(e) => { const to = e.target.value as Status; setValue(to); if (!keyed.current) commit(to); }}
        onBlur={() => { if (value !== app.status) commit(value); }}
      >
        {statusOrder.map((s) => (
          <option key={s} value={s}>{s === "accepted" && app.status !== "accepted" ? "Accepted…" : statusLabel[s]}</option>
        ))}
      </select>
    </>
  );
}

const byIcon = {
  you: <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M2 10.5c.6-2 2.1-3 4-3s3.4 1 4 3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  email: <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2.5" width="9" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="m2 3.2 4 3 4-3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  "apply-kit": <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 10.5 4.5 4l2 3.5L8 5.5l3 5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
};

/** Who or what caused an Event: icon plus words, never colour alone. */
export function By({ cause }: { cause: ApplicationSummary["lastEvent"]["cause"] }) {
  const cls = cause === "apply-kit" ? "app" : cause;
  return <span className={`by ${cls}`}>{byIcon[cause]}by {cause}</span>;
}
