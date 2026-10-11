// "Remove from watchlist…" (hi-fi: docs/design/hifi/sources.html, state "Remove company"). A modal
// that states exactly what closes and what stays open through other Sources before anything happens.
// It opens with focus on "Pause instead" (the safe choice); Esc or Cancel closes it.
import type { RemovalPreview, SourceHealth } from "@apply-kit/core";
import { useEffect, useRef, useState } from "react";
import { previewRemoval } from "../api.ts";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; preview: RemovalPreview };

export function RemoveDialog({ source, onRemove, onPause, onCancel }: {
  source: SourceHealth;
  onRemove: (preview: RemovalPreview) => void;
  onPause: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    previewRemoval(source.id, ctrl.signal)
      .then((preview) => setLoad({ state: "ready", preview }))
      .catch((err: unknown) => { if (!ctrl.signal.aborted) setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }); });
    return () => ctrl.abort();
  }, [source.id]);

  // Close the modal before handing back, so the page is no longer inert and focus can move.
  const done = (fn: () => void) => { ref.current?.close(); fn(); };
  const where = source.id.slice(source.kind.length + 1);
  const paused = source.status === "paused";

  return (
    <dialog ref={ref} className="pass-dialog remove-dialog" aria-labelledby="rm-h" aria-describedby="rm-d" onCancel={(e) => { e.preventDefault(); done(onCancel); }}>
      <div className="stack" style={{ gap: "var(--s-4)" }}>
        <h2 id="rm-h">Remove {source.name} from your watchlist?</h2>
        {load.state === "loading" && <p id="rm-d" className="meta" role="status">Working out what happens to its jobs…</p>}
        {load.state === "error" && <p id="rm-d" className="err" role="alert">Couldn't work out what removing it would do: {load.message}</p>}
        {load.state === "ready" && <Impact preview={load.preview} where={where} />}
        <div className="row">
          <button
            className="btn danger" type="button" disabled={load.state !== "ready"}
            onClick={() => { if (load.state === "ready") { const p = load.preview; done(() => onRemove(p)); } }}
          >
            {load.state === "ready" && load.preview.closing > 0 ? `Remove and close ${plural(load.preview.closing, "job")}` : "Remove"}
          </button>
          {!paused && <button className="btn" type="button" autoFocus onClick={() => done(onPause)}>Pause instead</button>}
          <button className="btn ghost" type="button" autoFocus={paused} onClick={() => done(onCancel)}>Cancel</button>
        </div>
        {!paused && <p className="meta">Pause stops checking but leaves the jobs open, in case you only want a break.</p>}
      </div>
    </dialog>
  );
}

function Impact({ preview: p, where }: { preview: RemovalPreview; where: string }) {
  return (
    <>
      <p id="rm-d" className="muted" style={{ fontSize: "var(--fs-small)" }}>
        apply-kit stops checking {where} on {p.label}.{" "}
        {p.openJobs === 0 ? "It has no open jobs, so nothing closes." : `Here's what happens to its ${plural(p.openJobs, "open job")}:`}
      </p>
      <ul className="impact">
        {p.closing > 0 && (
          <li>
            <b>{p.closing} found only here close</b> with the reason "Source removed". They move to <a href="/">Feed</a> › Passed &amp; closed; nothing is deleted.
          </li>
        )}
        {p.stayingOpen > 0 && (
          <li><b>{p.stayingOpen} also on {list(p.stayingVia.map((v) => v.name))} stay open</b> and keep being checked there.</li>
        )}
        <li>Passed jobs, packages and applications are never touched.</li>
      </ul>
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
