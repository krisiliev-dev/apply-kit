import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { AnswerRecord } from "../shared/types";
import { sendToBackground } from "../shared/message";

export function App(): ReactElement {
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q?: string): Promise<void> => {
    const resp = await sendToBackground({ kind: "listAnswers", query: q });
    if (resp.kind === "listAnswers") setRecords(resp.records);
    else if (resp.kind === "error") setStatus(`Error: ${resp.message}`);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const h = window.setTimeout(() => void refresh(query), 120);
    return () => window.clearTimeout(h);
  }, [query, refresh]);

  const onExport = useCallback(async (): Promise<void> => {
    const resp = await sendToBackground({ kind: "exportAll" });
    if (resp.kind !== "exportAll") return;
    const blob = new Blob([JSON.stringify(resp.records, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cv-autofill-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${resp.records.length} records.`);
  }, []);

  const onImport = useCallback(async (file: File, mode: "merge" | "replace"): Promise<void> => {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setStatus(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setStatus("Expected a JSON array of records.");
      return;
    }
    const resp = await sendToBackground({
      kind: "importAll",
      records: parsed as AnswerRecord[],
      mode,
    });
    if (resp.kind === "importAll") {
      setStatus(`Imported ${resp.imported} records.`);
      void refresh(query);
    } else if (resp.kind === "error") {
      setStatus(`Error: ${resp.message}`);
    }
  }, [query, refresh]);

  const onDelete = useCallback(async (id: string): Promise<void> => {
    const resp = await sendToBackground({ kind: "deleteAnswer", id });
    if (resp.kind === "deleteAnswer") {
      setRecords((prev) => prev.filter((r) => r.id !== id));
    }
  }, []);

  const beginEdit = useCallback((rec: AnswerRecord): void => {
    setEditing(rec.id);
    const last = rec.answers[rec.answers.length - 1];
    setDraft(last?.value ?? "");
  }, []);

  const saveEdit = useCallback(async (): Promise<void> => {
    if (!editing) return;
    const resp = await sendToBackground({
      kind: "updateAnswer",
      id: editing,
      value: draft,
    });
    if (resp.kind === "updateAnswer") {
      setRecords((prev) =>
        prev.map((r) => (r.id === resp.record.id ? resp.record : r)),
      );
    }
    setEditing(null);
    setDraft("");
  }, [editing, draft]);

  const total = records.length;
  const visible = useMemo(() => records, [records]);

  return (
    <div className="p-3 flex flex-col gap-3">
      <header className="flex items-end justify-between pb-2 border-b border-[var(--color-ink)]">
        <div>
          <div className="cvaf-label">CV Autofill</div>
          <h1 className="cvaf-h text-2xl leading-none">Your Q&amp;A memory</h1>
        </div>
        <div className="cvaf-label">
          {total} {total === 1 ? "entry" : "entries"}
        </div>
      </header>

      <div className="flex gap-2">
        <input
          className="cvaf-input"
          placeholder="Search questions or answers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button className="cvaf-btn" onClick={() => void onExport()}>
          Export JSON
        </button>
        <button
          className="cvaf-btn"
          onClick={() => fileRef.current?.click()}
        >
          Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f, "merge");
            e.target.value = "";
          }}
        />
      </div>

      {status && (
        <div className="cvaf-label" style={{ color: "var(--color-accent)" }}>
          {status}
        </div>
      )}

      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
        {visible.length === 0 && (
          <div className="cvaf-label">
            No entries yet. Fill out a job application — answers will appear here.
          </div>
        )}
        {visible.map((rec) => {
          const last = rec.answers[rec.answers.length - 1];
          const isEditing = editing === rec.id;
          return (
            <div key={rec.id} className="cvaf-card p-2 flex flex-col gap-1">
              <div className="cvaf-label flex justify-between">
                <span>{rec.fieldKind}</span>
                <span>
                  {rec.answers.length}{" "}
                  {rec.answers.length === 1 ? "version" : "versions"}
                </span>
              </div>
              <div className="cvaf-h text-base leading-snug">
                {rec.questionLabel || rec.questionNormalized}
              </div>
              {isEditing ? (
                <>
                  <textarea
                    className="cvaf-input"
                    rows={4}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <button className="cvaf-btn" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button className="cvaf-btn accent" onClick={() => void saveEdit()}>
                      Save
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {last?.value ?? "(empty)"}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button className="cvaf-btn" onClick={() => void onDelete(rec.id)}>
                      Delete
                    </button>
                    <button className="cvaf-btn" onClick={() => beginEdit(rec)}>
                      Edit
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <footer className="cvaf-label pt-2 border-t border-[var(--color-ink)]">
        Never auto-submits. You drive; the extension remembers.
      </footer>
    </div>
  );
}
