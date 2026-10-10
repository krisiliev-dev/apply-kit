import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { CapturedJob } from "../../shared/types";
import { sendToBackground } from "../../shared/message";
import { DEFAULT_CV_MAKER_BASE_URL } from "../../shared/config";

// Discovery panel — captured job postings, sync state, and base-URL config.

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DiscoveryPanel(): ReactElement {
  const [jobs, setJobs] = useState<CapturedJob[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_CV_MAKER_BASE_URL);
  const [baseDraft, setBaseDraft] = useState<string>(DEFAULT_CV_MAKER_BASE_URL);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const resp = await sendToBackground({ kind: "listJobs" });
    if (resp.kind === "listJobs") setJobs(resp.jobs);
    else if (resp.kind === "error") setStatus(`Error: ${resp.message}`);
  }, []);

  const refreshConfig = useCallback(async (): Promise<void> => {
    const resp = await sendToBackground({ kind: "getConfig" });
    if (resp.kind === "getConfig") {
      setBaseUrl(resp.cvMakerBaseUrl);
      setBaseDraft(resp.cvMakerBaseUrl);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshConfig();
  }, [refresh, refreshConfig]);

  const onSaveBaseUrl = useCallback(async (): Promise<void> => {
    const resp = await sendToBackground({
      kind: "setConfig",
      cvMakerBaseUrl: baseDraft,
    });
    if (resp.kind === "setConfig") {
      setBaseUrl(resp.cvMakerBaseUrl);
      setBaseDraft(resp.cvMakerBaseUrl);
      setStatus(`Web app URL saved: ${resp.cvMakerBaseUrl}`);
    } else if (resp.kind === "error") {
      setStatus(`Error: ${resp.message}`);
    }
  }, [baseDraft]);

  const onSyncAll = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setStatus("Syncing…");
    const resp = await sendToBackground({ kind: "syncDiscoveryQueue" });
    setSyncing(false);
    if (resp.kind === "error") {
      setStatus(`Error: ${resp.message}`);
      return;
    }
    const { result } = resp;
    if (result.total === 0) {
      setStatus("Nothing to sync.");
    } else if (result.failed === 0) {
      setStatus(`Synced ${result.synced} of ${result.total}.`);
    } else {
      setStatus(
        `Synced ${result.synced}/${result.total}. ${result.failed} still pending${
          result.error ? ` (${result.error})` : ""
        }.`,
      );
    }
    await refresh();
  }, [refresh]);

  const onSyncOne = useCallback(
    async (id: string): Promise<void> => {
      const resp = await sendToBackground({ kind: "syncJob", id });
      if (resp.kind === "error") {
        setStatus(`Error: ${resp.message}`);
        return;
      }
      setStatus(
        resp.synced ? "Synced." : "Still pending — web app unreachable.",
      );
      await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (id: string): Promise<void> => {
      const resp = await sendToBackground({ kind: "deleteJob", id });
      if (resp.kind === "deleteJob") {
        setJobs((prev) => prev.filter((j) => j.id !== id));
      } else if (resp.kind === "error") {
        setStatus(`Error: ${resp.message}`);
      }
    },
    [],
  );

  const onOpenUrl = useCallback((url: string): void => {
    // Opening via chrome.tabs keeps the popup open's host rules happy and
    // is also what the user expects (new tab, not nav the popup iframe).
    chrome.tabs.create({ url }).catch(() => {
      // Fallback: let the browser handle it.
      window.open(url, "_blank", "noopener");
    });
  }, []);

  const { total, synced, unsynced } = useMemo(() => {
    const s = jobs.filter((j) => j.syncedToWebApp).length;
    return { total: jobs.length, synced: s, unsynced: jobs.length - s };
  }, [jobs]);

  const baseUrlDirty = baseDraft.trim().replace(/\/+$/, "") !== baseUrl;

  return (
    <>
      <div className="cvaf-label flex justify-between">
        <span>
          {total} captured · {synced} synced · {unsynced} pending
        </span>
        <span>{baseUrl}</span>
      </div>

      {status && (
        <div className="cvaf-label" style={{ color: "var(--color-accent)" }}>
          {status}
        </div>
      )}

      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
        {jobs.length === 0 && (
          <div className="cvaf-label">
            No captures yet. Visit a job posting on LinkedIn, Indeed, or
            Glassdoor and click the pill.
          </div>
        )}
        {jobs.map((job) => (
          <div key={job.id} className="cvaf-card p-2 flex flex-col gap-1">
            <div className="cvaf-label flex justify-between">
              <span>{job.source}</span>
              <span>
                {job.syncedToWebApp ? "synced" : "pending"} ·{" "}
                {formatDate(job.capturedAt)}
              </span>
            </div>
            <div className="cvaf-h text-base leading-snug">{job.title}</div>
            <div className="text-sm">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
              {job.salary ? ` · ${job.salary}` : ""}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="cvaf-btn"
                onClick={() => onOpenUrl(job.url)}
                title={job.url}
              >
                Open URL
              </button>
              {!job.syncedToWebApp && (
                <button
                  className="cvaf-btn"
                  onClick={() => void onSyncOne(job.id)}
                >
                  Sync now
                </button>
              )}
              <button className="cvaf-btn" onClick={() => void onDelete(job.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <footer className="flex flex-col gap-2 pt-2 border-t border-[var(--color-ink)]">
        <div className="cvaf-label">Web app URL</div>
        <div className="flex gap-2">
          <input
            className="cvaf-input"
            placeholder={DEFAULT_CV_MAKER_BASE_URL}
            value={baseDraft}
            onChange={(e) => setBaseDraft(e.target.value)}
          />
          <button
            className={`cvaf-btn ${baseUrlDirty ? "accent" : ""}`}
            onClick={() => void onSaveBaseUrl()}
            disabled={!baseUrlDirty}
          >
            Save
          </button>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            className="cvaf-btn accent"
            disabled={syncing || unsynced === 0}
            onClick={() => void onSyncAll()}
          >
            {syncing ? "Syncing…" : "Sync all now"}
          </button>
        </div>
      </footer>
    </>
  );
}
