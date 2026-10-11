// The Sofia starter watchlist on Sources & watchlist: adds every company with a verified job feed in
// one step, and lists the companies without a feed with the alert route that still catches their jobs.
import type { CompanyWithoutFeed, WatchlistSeed } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { fetchStarterWatchlist, seedStarterWatchlist } from "../api.ts";
import { Chip } from "../health.tsx";

export function StarterWatchlist({ reloadKey, onSeeded, onError }: {
  /** Changes whenever the watchlist changes, so the counts stay current. */
  reloadKey: number;
  onSeeded: (seed: WatchlistSeed) => void;
  onError: (message: string) => void;
}) {
  const [starter, setStarter] = useState<WatchlistSeed | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchStarterWatchlist(ctrl.signal).then(setStarter).catch(() => { /* The panel stays hidden; the page shows the service error. */ });
    return () => ctrl.abort();
  }, [reloadKey]);

  if (!starter) return null;
  const toAdd = starter.sources.filter((s) => s.status === "to-add").length;
  const onList = starter.sources.filter((s) => s.status === "on-watchlist" || s.status === "added").length;
  const keptOff = starter.sources.filter((s) => s.status === "paused" || s.status === "removed").length;
  const total = starter.sources.length + starter.withoutFeed.length;

  const seed = () => {
    setSeeding(true);
    seedStarterWatchlist()
      .then((s) => { setStarter(s); onSeeded(s); })
      .catch((err: unknown) => onError(`Couldn't add the starter watchlist: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setSeeding(false));
  };

  return (
    <section className="panel stack" style={{ gap: "var(--s-4)" }} aria-labelledby="starter-h">
      <div className="panel-h">
        <div className="stack" style={{ gap: "var(--s-1)" }}>
          <h2 id="starter-h">Sofia starter watchlist</h2>
          <p className="meta">
            {total} Sofia employers (international, local, startups and remote-first): {starter.sources.length} with a job feed apply-kit can check
            {onList > 0 && `, ${onList} already on your watchlist`}
            {keptOff > 0 && `, ${keptOff} you paused or removed (kept that way)`}.
          </p>
        </div>
        <span className="grow" />
        {toAdd > 0
          ? <button className="btn primary" type="button" onClick={seed} disabled={seeding}>{seeding ? "Adding…" : `Add ${toAdd} ${toAdd === 1 ? "company" : "companies"} with a feed`}</button>
          : <Chip tone="ok">All feeds added</Chip>}
      </div>
      {starter.withoutFeed.length > 0 && (
        <details>
          <summary>{starter.withoutFeed.length} companies without a feed: catch their jobs with email alerts</summary>
          <div className="table-wrap">
            <table className="table" aria-label="Starter watchlist companies without a job feed">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Why no feed</th>
                  <th scope="col">Suggested route</th>
                  <th scope="col">Alerts reach the Feed</th>
                </tr>
              </thead>
              <tbody>{starter.withoutFeed.map((c) => <WithoutFeedRow key={c.company} company={c} />)}</tbody>
            </table>
          </div>
          <p className="table-foot">
            Alerts are sent to your job address and read from the job mailbox. A route shows as not connected until its email-alert source ({unique(starter.withoutFeed.map((c) => c.route.sourceName)).join(", ")}) is on your watchlist; set it in the <code>APPLY_KIT_SOURCES</code> setting.
          </p>
        </details>
      )}
    </section>
  );
}

function WithoutFeedRow({ company: c }: { company: CompanyWithoutFeed }) {
  return (
    <tr>
      <td>
        <span className="src-name">{c.company}</span>
        <a className="src-id" href={c.careers} target="_blank" rel="noreferrer">Careers page<span className="sr-only"> of {c.company} (opens in a new tab)</span></a>
      </td>
      <td>{c.why}</td>
      <td>{c.route.how}</td>
      <td>{c.route.connected ? <Chip tone="ok">Connected</Chip> : <Chip tone="none">Not connected</Chip>}</td>
    </tr>
  );
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
