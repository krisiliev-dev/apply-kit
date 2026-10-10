import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { PairedDeviceSummary } from "../../shared/types";
import { sendToBackground } from "../../shared/message";
import { DEFAULT_CV_MAKER_BASE_URL } from "../../shared/config";

// Pair panel — sibling to Q&A / Discovery. Two states:
//   1. Unpaired: collect web-app URL + pair code + device label.
//   2. Paired:   show summary, last-sync timestamp, Unpair button.
//
// The actual pairing handshake lives in the service worker (uses WebCrypto
// to generate a keypair); this panel just shuttles user input over the
// message bus.

function formatDate(ms: number): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PairPanel(): ReactElement {
  const [pairing, setPairing] = useState<PairedDeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [webAppUrl, setWebAppUrl] = useState<string>(DEFAULT_CV_MAKER_BASE_URL);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(() => defaultLabel());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const resp = await sendToBackground({ kind: "getPairing" });
    if (resp.kind === "getPairing") setPairing(resp.pairing);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    // Also pull current base-url so the URL field starts with the user's
    // existing config rather than the default.
    void (async () => {
      const resp = await sendToBackground({ kind: "getConfig" });
      if (resp.kind === "getConfig") setWebAppUrl(resp.cvMakerBaseUrl);
    })();
  }, [refresh]);

  const canSubmit = useMemo(() => {
    return (
      webAppUrl.trim().length > 0 &&
      code.trim().length > 0 &&
      label.trim().length > 0 &&
      !busy
    );
  }, [webAppUrl, code, label, busy]);

  const onPair = useCallback(async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    const resp = await sendToBackground({
      kind: "completePairing",
      webAppUrl,
      code,
      deviceLabel: label,
    });
    setBusy(false);
    if (resp.kind === "completePairing") {
      setPairing(resp.pairing);
      setStatus("Paired.");
      setCode("");
    } else if (resp.kind === "error") {
      setStatus(`Error: ${resp.message}`);
    }
  }, [webAppUrl, code, label]);

  const onUnpair = useCallback(async (): Promise<void> => {
    if (!window.confirm("Unpair this device? You'll need a new pair code to re-sync in the background.")) {
      return;
    }
    setBusy(true);
    const resp = await sendToBackground({ kind: "unpair" });
    setBusy(false);
    if (resp.kind === "unpair") {
      setPairing(null);
      setStatus("Unpaired.");
    } else if (resp.kind === "error") {
      setStatus(`Error: ${resp.message}`);
    }
  }, []);

  if (loading) {
    return <div className="cvaf-label">Loading…</div>;
  }

  if (pairing) {
    return (
      <>
        <div className="cvaf-card p-2 flex flex-col gap-1">
          <div className="cvaf-label flex justify-between">
            <span>paired · …{pairing.deviceId.slice(-6)}</span>
            <span>last sync {formatDate(pairing.lastSyncAt)}</span>
          </div>
          <div className="cvaf-h text-base leading-snug">{pairing.deviceLabel}</div>
          <div className="text-sm">{pairing.webAppUrl}</div>
          <div className="text-xs opacity-70">Paired {formatDate(pairing.pairedAt)}</div>
          <div className="flex gap-2 justify-end mt-2">
            <button className="cvaf-btn" disabled={busy} onClick={() => void onUnpair()}>
              Unpair
            </button>
          </div>
        </div>
        {status && (
          <div className="cvaf-label" style={{ color: "var(--color-accent)" }}>
            {status}
          </div>
        )}
        <div className="cvaf-label opacity-70">
          Captures sync in the background every 5 minutes — no tab required.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cvaf-label">
        On the CV-maker web app, open <span className="cvaf-h text-sm">/pair</span> to
        generate a code, then paste it here.
      </div>
      <div className="flex flex-col gap-2">
        <label className="cvaf-label">Web app URL</label>
        <input
          className="cvaf-input"
          placeholder={DEFAULT_CV_MAKER_BASE_URL}
          value={webAppUrl}
          onChange={(e) => setWebAppUrl(e.target.value)}
        />
        <label className="cvaf-label">Pair code</label>
        <input
          className="cvaf-input"
          placeholder="ASTRID-PONY-CEDAR-1234"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <label className="cvaf-label">Device label</label>
        <input
          className="cvaf-input"
          placeholder="MacBook Chrome"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="flex gap-2 justify-end">
          <button
            className={`cvaf-btn accent`}
            onClick={() => void onPair()}
            disabled={!canSubmit}
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
        </div>
      </div>
      {status && (
        <div className="cvaf-label" style={{ color: "var(--color-accent)" }}>
          {status}
        </div>
      )}
      <div className="cvaf-label opacity-70">
        Without pairing, the extension still works — captures sync only while
        the web app has a tab open on /discover. Pair to sync when every tab
        is closed.
      </div>
    </>
  );
}

function defaultLabel(): string {
  if (typeof navigator === "undefined") return "Chrome";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "Mac · Chrome";
  if (/Win/i.test(ua)) return "Windows · Chrome";
  if (/Linux/i.test(ua)) return "Linux · Chrome";
  return "Chrome";
}
