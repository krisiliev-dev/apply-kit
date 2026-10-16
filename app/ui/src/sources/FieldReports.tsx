// Settings › the Chrome extension › Field reports (Apply #48): the fields Kris reported from the panel
// with "Report this field", each its structure only (never a value), where it was, and when. "Copy as
// fixture" puts the HTML snippet a filler fixture is made from on the clipboard; Delete removes it.
import { useEffect, useState } from "react";
import { deleteFieldReport, fetchFieldReports, type ListedFieldReport } from "../api.ts";

const portalNames: Record<string, string> = { workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", smartrecruiters: "SmartRecruiters", workable: "Workable", ashby: "Ashby" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const labelOf = (r: ListedFieldReport) => r.field.labelChain[0]?.text ?? "A field without a label";

export function FieldReports() {
  const [reports, setReports] = useState<ListedFieldReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const reload = () => fetchFieldReports().then(setReports, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  useEffect(() => { void reload(); }, []);

  const copy = async (r: ListedFieldReport) => {
    const ok = await navigator.clipboard.writeText(r.fixture).then(() => true, () => false);
    setSaid(ok ? `Copied ${labelOf(r)} as a fixture.` : "Couldn't copy: the browser didn't allow it.");
  };
  const remove = async (r: ListedFieldReport) => {
    setError(null);
    try {
      await deleteFieldReport(r.id);
      setSaid(`Deleted the report of ${labelOf(r)}.`);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="stack" aria-labelledby="field-reports-h" role="group">
      <div className="stack">
        <h3 id="field-reports-h">Field reports</h3>
        <p className="muted">
          Fields you reported from the panel with "Report this field": each one's structure (labels, kind, options, attributes),
          never what was in it. They stay on this laptop. Copy one as a fixture to fix the portal's filler.
        </p>
      </div>
      {error && <p className="banner error" role="alert"><span className="text">{error}</span></p>}
      {reports && reports.length === 0 && <p className="meta">No field reports yet.</p>}
      {reports && reports.length > 0 && (
        <ul className="stack field-reports" aria-label="Field reports">
          {reports.map((r) => (
            <li key={r.id} className="row">
              <span className="grow">
                <b>{labelOf(r)}</b> · {r.field.kind}
                <span className="meta block">
                  {portalNames[r.portal] ?? r.portal} · {r.host}{r.path}{r.stepLabel ? ` · ${r.stepLabel}` : ""} · reported {date(r.createdAt)}
                </span>
              </span>
              <button className="btn sm" type="button" onClick={() => void copy(r)} aria-label={`Copy ${labelOf(r)} as fixture`}>Copy as fixture</button>
              <button className="btn sm ghost" type="button" onClick={() => void remove(r)} aria-label={`Delete the report of ${labelOf(r)}`}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
    </div>
  );
}
