// Profile (hi-fi: docs/design/hifi/profile.html): the master profile with contact details, Add and
// Edit piece, section links to Profile's areas, and Angles (#58). The answer bank and voice arrive with
// later tickets; Search and dealbreakers is the existing search settings page.
import type { Angle, Contact, HealthSummary, PieceGroup, PieceKind, PieceList, ProfilePiece, ProfileSummary } from "@apply-kit/core";
import { angles, pieceKinds } from "@apply-kit/core/profile";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmPiece, deletePiece, fetchContact, fetchPieces, fetchProfileSummary, fetchSources, profileExportUrl } from "../api.ts";
import { Icon } from "../icons.tsx";
import { SearchSettingsPage } from "../settings/SearchSettingsPage.tsx";
import { AnglesPage } from "./AnglesPage.tsx";
import { ContactPanel } from "./ContactPanel.tsx";
import { PieceEditor } from "./PieceEditor.tsx";
import {
  ProfileSections, angleLabel, kindLabel, kindPlural, message, navLink, numberSourceLabel, pieceName, pieceText, type Go,
} from "./common.tsx";

/** Pieces shown per group before "Show N more". */
const GROUP_PREVIEW = 4;

export function ProfilePage({ onHealth, onSummary }: { onHealth: (h: HealthSummary) => void; onSummary: (s: ProfileSummary) => void }) {
  const [path, setPath] = useState(window.location.pathname);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [live, setLive] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const announce = useCallback((msg: string) => {
    setLive("");
    window.setTimeout(() => setLive(msg), 60);
  }, []);

  const go: Go = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);

  const refreshSummary = useCallback(() => {
    fetchProfileSummary().then((s) => { setSummary(s); onSummary(s); }).catch(() => {});
  }, [onSummary]);

  useEffect(() => {
    const back = () => setPath(window.location.pathname);
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  useEffect(() => { refreshSummary(); }, [refreshSummary]);

  // The top bar shows source health on every screen.
  useEffect(() => {
    if (path === "/profile/search") return;
    const ctrl = new AbortController();
    fetchSources(ctrl.signal).then((r) => onHealth(r.summary)).catch(() => {});
    return () => ctrl.abort();
  }, [onHealth, path]);

  const saved = (said: string) => {
    setFlash(said);
    refreshSummary();
    go("/profile");
  };

  const piece = /^\/profile\/pieces\/(.+)$/.exec(path)?.[1];
  const head = (
    <>
      <div className="page-head">
        <div className="lead">
          <h1 id="profile-h" tabIndex={-1}>Profile</h1>
          <p className="muted">Everything tailoring draws from. Nothing goes into a CV, letter or answer that isn't here.</p>
        </div>
        <span className="grow" />
        <span className="local"><Icon name="lock" />Stored on this laptop only · <a href={profileExportUrl} download>Export<span className="sr-only"> your profile as a JSON file</span></a></span>
      </div>
      <ProfileSections current={path} summary={summary} go={go} />
    </>
  );

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{live}</div>
      {piece !== undefined ? (
        <PieceEditor key={piece} id={piece === "new" ? null : decodeURIComponent(piece)} go={go} announce={announce} onSaved={saved} />
      ) : path === "/profile/search" ? (
        <section className="stack" style={{ gap: "var(--s-6)" }}>
          {head}
          <SearchSettingsPage onHealth={onHealth} />
        </section>
      ) : path === "/profile/angles" ? (
        <section className="stack" style={{ gap: "var(--s-6)" }}>
          {head}
          <AnglesPage announce={announce} />
        </section>
      ) : path === "/profile/answers" || path === "/profile/voice" ? (
        <section className="stack" style={{ gap: "var(--s-6)" }}>
          {head}
          <NotYet area={path === "/profile/answers" ? "The answer bank" : "Voice"} />
        </section>
      ) : (
        <section className="stack" style={{ gap: "var(--s-6)" }}>
          {head}
          <MasterProfile go={go} announce={announce} flash={flash} clearFlash={() => setFlash(null)} onChanged={refreshSummary} />
        </section>
      )}
    </>
  );
}

function NotYet({ area }: { area: string }) {
  return (
    <div className="empty">
      <h2>{area} isn't built yet</h2>
      <p>It arrives with a later part of Prepare. Your master profile is ready to fill.</p>
    </div>
  );
}

function MasterProfile({ go, announce, flash, clearFlash, onChanged }: {
  go: Go;
  announce: (msg: string) => void;
  flash: string | null;
  clearFlash: () => void;
  onChanged: () => void;
}) {
  /** Bumped when a drafted piece is confirmed or discarded, to read the list again. */
  const [version, setVersion] = useState(0);
  const changed = useCallback((said: string) => {
    setVersion((v) => v + 1);
    onChanged();
    announce(said);
  }, [onChanged, announce]);
  const [kind, setKind] = useState<PieceKind | undefined>();
  const [angle, setAngle] = useState<Angle | undefined>();
  const [search, setSearch] = useState("");
  const [list, setList] = useState<PieceList | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtering = kind !== undefined || angle !== undefined || search.trim() !== "";
  const first = useRef(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchContact(ctrl.signal).then(setContact).catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    return () => ctrl.abort();
  }, []);

  // After a save or delete, say what happened and put focus on the page's heading.
  useEffect(() => {
    if (!flash) return;
    announce(flash);
    clearFlash();
    window.setTimeout(() => document.getElementById("profile-h")?.focus(), 0);
  }, [flash, announce, clearFlash]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetchPieces({ kind, angle, search }, ctrl.signal)
        .then((l) => {
          setList(l);
          setError(null);
          if (!first.current) announce(`${shownCount(l)} ${shownCount(l) === 1 ? "piece" : "pieces"} shown.`);
          first.current = false;
        })
        .catch((err: unknown) => { if (!ctrl.signal.aborted) setError(message(err)); });
    }, search ? 200 : 0);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [kind, angle, search, announce, version]);

  if (error) return <div className="banner error" role="alert"><span className="text"><b>Couldn't load your profile.</b> {error}</span></div>;
  if (!list || !contact) return <p className="meta" role="status">Loading your profile…</p>;

  const contactPanel = <ContactPanel contact={contact} onChange={setContact} announce={announce} />;

  if (list.total === 0) {
    return (
      <>
        <div className="empty">
          <h2>Your master profile is empty</h2>
          <p>Every CV, cover letter and portal answer is built from it. Setup imports your old CVs, lets a coach question them and fill the gaps, then checks your search settings. About 30–45 minutes; you can stop any time and nothing is lost.</p>
          <div className="row">
            <a className="btn primary" href="/setup">Start setup</a>
            <a className="btn" href="/profile/pieces/new" onClick={navLink(go)}>Add your first piece and start applying</a>
          </div>
          <p className="meta">The quick start works, but your first packages will be thinner. The profile fills in from questions asked while you apply.</p>
        </div>
        {contactPanel}
      </>
    );
  }

  const all = pieceKinds.reduce((n, k) => n + list.byKind[k], 0);
  const clear = () => { setKind(undefined); setAngle(undefined); setSearch(""); };

  return (
    <>
      {contactPanel}
      <section className="panel" aria-labelledby="pieces-h">
        <div className="sec-head">
          <h2 className="grow" id="pieces-h">Master profile <span className="meta">· {list.total} {list.total === 1 ? "piece" : "pieces"} · {list.confirmed} confirmed</span></h2>
          <a className="btn ghost" href="/setup">Import old CVs</a>
          <a className="btn" href="/profile/pieces/new" onClick={navLink(go)}>Add piece</a>
        </div>
        <div className="toolbar">
          <div className="search pieces-search">
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <label className="sr-only" htmlFor="ps">Search pieces</label>
            <input className="input" id="ps" type="search" placeholder="Search pieces, e.g. Splunk…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="segmented" role="group" aria-label="Type">
            <button type="button" aria-pressed={kind === undefined} onClick={() => setKind(undefined)}>All <span className="num">{all}</span></button>
            {(["achievement", "skill", "role", "education"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{kindPlural[k]} <span className="num">{list.byKind[k]}</span></button>
            ))}
          </div>
          <label className="sr-only" htmlFor="pa">Angle</label>
          <select className="input angle-select" id="pa" value={angle ?? ""} onChange={(e) => setAngle((e.target.value || undefined) as Angle | undefined)}>
            <option value="">Every angle</option>
            {angles.map((a) => <option key={a} value={a}>{angleLabel[a]}</option>)}
          </select>
        </div>

        {list.groups.length === 0 ? (
          <div className="row">
            <span className="meta grow">No pieces match.</span>
            <button className="btn sm" type="button" onClick={clear}>Clear search and filters</button>
          </div>
        ) : list.groups.map((g, i) => (
          <Group key={`${g.id}:${filtering}`} group={g} open={filtering || i === 0} go={go} changed={changed} />
        ))}
      </section>
    </>
  );
}

const shownCount = (l: PieceList) => l.groups.reduce((n, g) => n + g.pieces.length, 0);

function Group({ group, open, go, changed }: { group: PieceGroup; open: boolean; go: Go; changed: (said: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.pieces : group.pieces.slice(0, GROUP_PREVIEW);
  const more = group.pieces.length - shown.length;
  const head = group.pieces.find((p) => p.id === group.id);
  const nextRef = useRef<HTMLDivElement>(null);

  const showMore = () => {
    setExpanded(true);
    // Focus lands on the first piece that was hidden, so the keyboard path continues where it was.
    window.setTimeout(() => nextRef.current?.focus(), 0);
  };

  return (
    <details className="group" open={open}>
      <summary>
        <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        {group.label} <span className="meta">{group.pieces.length} {group.pieces.length === 1 ? "piece" : "pieces"}</span>
      </summary>
      <div className="pieces">
        {shown.map((p, i) => <PieceCard key={p.id} piece={p} go={go} changed={changed} focusRef={expanded && i === GROUP_PREVIEW ? nextRef : undefined} />)}
      </div>
      {more > 0 && (
        <button className="btn ghost sm show-more" type="button" onClick={showMore}>
          Show {more} more{head?.entry ? ` from ${head.entry.organisation}` : ""}
        </button>
      )}
    </details>
  );
}

function PieceCard({ piece: p, go, changed, focusRef }: { piece: ProfilePiece; go: Go; changed: (said: string) => void; focusRef?: React.Ref<HTMLDivElement> }) {
  const status = p.status === "unconfirmed" ? "unconfirmed" : p.status === "flagged" ? "flagged" : "";
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const name = `${kindLabel[p.kind].toLowerCase()}: ${pieceName(p)}`;
  // Focus follows a refusal to its reason.
  useEffect(() => { if (refusal) refusalRef.current?.focus(); }, [refusal]);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await confirmPiece(p.id);
      if (result.saved) return changed(`Confirmed ${name}.`);
      setRefusal(result.problems.map((x) => x.message));
    } catch (err) {
      setRefusal([message(err)]);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    setBusy(true);
    try {
      await deletePiece(p.id);
      changed(`Discarded ${name}.`);
    } catch (err) {
      setRefusal([message(err)]);
      setBusy(false);
    }
  };

  return (
    <div className={`piece ${status}`} ref={focusRef} tabIndex={focusRef ? -1 : undefined}>
      <div className="stack">
        <div className="top">
          <span className="type">{kindLabel[p.kind].toUpperCase()}</span>
          {p.status === "unconfirmed" && <span className="chip ask"><Icon name="ask" />Unconfirmed</span>}
          {p.status === "flagged" && <span className="chip partly"><Icon name="line" />Near the line</span>}
          {p.checkThis && <span className="chip partly"><Icon name="partly" />Check this: read from a scan</span>}
          <span>{p.source.from}{p.alsoFrom.length > 0 && ` · also in ${[...new Set(p.alsoFrom.map((s) => s.from))].join(", ")}`}</span>
          {p.numberSource && <span>{numberSourceLabel[p.numberSource]}</span>}
        </div>
        <p className="text">{pieceText(p)}</p>
        {p.entry && p.text && <p className="mini muted">{p.text}</p>}
        {p.status === "unconfirmed" && p.source.quote && (
          <p className="mini muted">From the source: <q>{p.source.quote}</q></p>
        )}
        {(p.tags.length > 0 || p.angles.length > 0) && (
          <div className="chips">
            {p.tags.map((t) => <span className="chip neutral" key={t}>{t}</span>)}
            {p.angles.map((a) => <span className="chip met" key={a}>{angleLabel[a]}</span>)}
          </div>
        )}
        {refusal && (
          <div className="banner warning" role="alert" tabIndex={-1} ref={refusalRef}>
            <span className="text"><b>Can't confirm yet.</b> {refusal.join(" ")} Use Edit to add it.</span>
          </div>
        )}
      </div>
      <div className="acts">
        {p.status === "unconfirmed" && (
          <button className="btn sm" type="button" disabled={busy} onClick={confirm}>
            Confirm<span className="sr-only"> {name}</span>
          </button>
        )}
        <a className="btn ghost sm" href={`/profile/pieces/${encodeURIComponent(p.id)}`} onClick={navLink(go)}>
          Edit<span className="sr-only"> {name}</span>
        </a>
        {p.status === "unconfirmed" && (
          <button className="btn ghost sm" type="button" disabled={busy} onClick={discard}>
            Discard<span className="sr-only"> {name}</span>
          </button>
        )}
      </div>
    </div>
  );
}
