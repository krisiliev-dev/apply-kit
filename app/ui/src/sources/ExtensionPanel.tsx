// The Chrome extension's pairing: show a one-time code to type into the extension, list the
// extensions paired with this app, and forget one. Only a paired extension can capture pages.
import type { PairedDevice } from "@apply-kit/core";
import { useEffect, useState } from "react";
import { fetchPairedDevices, startPairing, unpairDevice } from "../api.ts";
import { FieldReports } from "./FieldReports.tsx";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export function ExtensionPanel() {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => fetchPairedDevices().then(setDevices, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  useEffect(() => { void reload(); }, []);

  const pair = async () => {
    setError(null);
    try {
      setCode(await startPairing());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const unpair = async (d: PairedDevice) => {
    await unpairDevice(d.id).catch(() => {});
    void reload();
  };

  return (
    <section className="panel" aria-labelledby="extension-h">
      <div className="stack">
        <h2 id="extension-h">Chrome extension</h2>
        <p className="muted">
          Captures the job page, or the search results, you have open in Chrome. It only reads a page when you click,
          never scrolls or opens listings, and keeps nothing of its own. It needs pairing once with this app.
        </p>
      </div>
      {code ? (
        <div className="stack" role="status">
          <p>Type this code into the extension (click the apply-kit icon in Chrome). It works once, until {time(code.expiresAt)}.</p>
          <p className="pair-code" aria-label={`Pairing code ${code.code.split("").join(" ")}`}>{code.code.slice(0, 3)} {code.code.slice(3)}</p>
          <div><button className="btn sm" type="button" onClick={() => { setCode(null); void reload(); }}>Done</button></div>
        </div>
      ) : (
        <div><button className="btn primary" type="button" onClick={() => void pair()}>Pair the extension</button></div>
      )}
      {error && <p className="banner error" role="alert"><span className="text">{error}</span></p>}
      {devices && devices.length > 0 && (
        <ul className="stack" aria-label="Paired extensions">
          {devices.map((d) => (
            <li key={d.id} className="row">
              <span className="grow">{d.name} · paired {date(d.pairedAt)} · last used {date(d.lastUsedAt)}</span>
              <button className="btn sm ghost" type="button" onClick={() => void unpair(d)}>Unpair</button>
            </li>
          ))}
        </ul>
      )}
      {devices && devices.length === 0 && !code && <p className="meta">No extension is paired yet.</p>}
      <FieldReports />
    </section>
  );
}
