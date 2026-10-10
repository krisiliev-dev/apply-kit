"use client";

import { useCallback, useMemo, useState } from "react";
import { useApplications } from "@/lib/app/store";
import type {
  Application,
  OfferRecord,
  RemoteMode,
  SalaryAnalysis,
} from "@/lib/app/types";
import { cvs } from "@/content/cvs";
import { getBaseCv } from "@/lib/profile/base";
import { formatDateTime } from "@/lib/app/ui";
import { ApiKeyHint } from "@/components/errors/ApiKeyHint";
import { trackedFetch } from "@/lib/ai/tokenLedger";

// SalaryNegotiationSection — appears on the application detail page when
// status is offer/interview. Three-step flow:
//   1. No offer yet → paste + "Parse offer" → editable structured fields → "Save offer".
//   2. Offer exists, no analysis → "Analyze" → shows three cards (Market / Leverage / Counter).
//   3. Analysis exists → copy-to-clipboard + regenerate.
//
// Persists via store actions `setOffer` + `setSalaryAnalysis`.

function resolveBaseCV(cvSlug?: string) {
  if (cvSlug && cvs[cvSlug]) return cvs[cvSlug];
  return getBaseCv();
}

export function SalaryNegotiationSection({ app }: { app: Application }) {
  const { setOffer, setSalaryAnalysis } = useApplications();

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60">
          Salary negotiation
        </h2>
        {app.offer && (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40">
            Received {formatDateTime(app.offer.receivedAt)}
          </span>
        )}
      </div>

      {!app.offer ? (
        <OfferCapture
          onParsed={(offer) => setOffer(app.id, offer)}
          onClear={() => setOffer(app.id, undefined)}
        />
      ) : (
        <>
          <OfferDisplay
            offer={app.offer}
            onSave={(next) => setOffer(app.id, next)}
            onClear={() => {
              setOffer(app.id, undefined);
              setSalaryAnalysis(app.id, undefined);
            }}
          />
          <AnalysisPanel
            app={app}
            onAnalysis={(analysis) => setSalaryAnalysis(app.id, analysis)}
          />
        </>
      )}
    </section>
  );
}

// ———————————————————————————————————————————————
// Offer capture (paste + parse)
// ———————————————————————————————————————————————

function OfferCapture({
  onParsed,
  onClear,
}: {
  onParsed: (offer: OfferRecord) => void;
  onClear: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfferRecord | null>(null);

  const onParse = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await trackedFetch("/api/salary/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawOfferText: raw }),
      });
      const data = (await res.json()) as { offer?: OfferRecord; error?: string };
      if (!res.ok || !data.offer) {
        setError(data.error ?? "Parse failed.");
        return;
      }
      setDraft(data.offer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [raw]);

  return (
    <div className="border border-ink/10 p-5">
      {!draft ? (
        <>
          <p className="font-display italic text-ink/60 leading-snug mb-4">
            Paste the offer — email body, Slack message, whatever. We'll pull
            the structured pieces.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={6}
            placeholder="e.g. Base $180k + 0.4% equity (4yr, 1yr cliff) + $25k sign-on + 15% target bonus + 20 PTO days. Remote."
            className="w-full bg-transparent border border-ink/10 hover:border-ink/20 focus:border-ink/60 focus:outline-none px-3 py-2 text-sm leading-relaxed placeholder:text-ink/30 resize-y"
          />
          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={onParse}
              disabled={busy || raw.trim().length === 0}
              className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
            >
              {busy ? "Parsing…" : "Parse offer"}
            </button>
            {raw && (
              <button
                type="button"
                onClick={() => setRaw("")}
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {error && (
            <div className="mt-3">
              <ApiKeyHint error={error} inline />
            </div>
          )}
        </>
      ) : (
        <OfferDraftEditor
          draft={draft}
          onSave={(next) => {
            onParsed(next);
            setDraft(null);
            setRaw("");
          }}
          onCancel={() => {
            setDraft(null);
            onClear();
          }}
        />
      )}
    </div>
  );
}

function OfferDraftEditor({
  draft,
  onSave,
  onCancel,
}: {
  draft: OfferRecord;
  onSave: (offer: OfferRecord) => void;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState<OfferRecord>(draft);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 mb-4">
        Verify the parsed fields — edit any that look off, then save.
      </p>
      <OfferEditGrid offer={local} onChange={setLocal} />
      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => onSave(local)}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80"
        >
          Save offer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function OfferEditGrid({
  offer,
  onChange,
}: {
  offer: OfferRecord;
  onChange: (next: OfferRecord) => void;
}) {
  const set = <K extends keyof OfferRecord>(key: K, value: OfferRecord[K]) =>
    onChange({ ...offer, [key]: value });

  return (
    <div className="grid grid-cols-[130px_1fr] gap-y-3 gap-x-5 items-center text-sm">
      <Label>Base</Label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          aria-label="Base salary"
          value={offer.baseSalary}
          onChange={(e) => set("baseSalary", Number(e.target.value) || 0)}
          className="font-mono bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 w-40"
        />
        <input
          type="text"
          aria-label="Currency code"
          value={offer.currency}
          onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
          className="font-mono bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 w-16 uppercase"
        />
      </div>

      <Label>Equity</Label>
      <input
        type="text"
        aria-label="Equity"
        value={offer.equity ?? ""}
        onChange={(e) => set("equity", e.target.value || undefined)}
        placeholder="0.25% vesting 4yr, 1yr cliff"
        className="bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 placeholder:text-ink/40"
      />

      <Label>Bonus</Label>
      <input
        type="text"
        aria-label="Bonus"
        value={offer.bonus ?? ""}
        onChange={(e) => set("bonus", e.target.value || undefined)}
        placeholder="15% target"
        className="bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 placeholder:text-ink/40"
      />

      <Label>Sign-on</Label>
      <input
        type="number"
        aria-label="Sign-on bonus"
        value={offer.signOn ?? ""}
        onChange={(e) =>
          set("signOn", e.target.value ? Number(e.target.value) : undefined)
        }
        placeholder="0"
        className="font-mono bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 w-40 placeholder:text-ink/40"
      />

      <Label>PTO</Label>
      <input
        type="number"
        aria-label="PTO days"
        value={offer.ptoDays ?? ""}
        onChange={(e) =>
          set("ptoDays", e.target.value ? Number(e.target.value) : undefined)
        }
        placeholder="days"
        className="font-mono bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 w-24 placeholder:text-ink/40"
      />

      <Label>Remote</Label>
      <select
        value={offer.remote ?? ""}
        onChange={(e) =>
          set("remote", (e.target.value || undefined) as RemoteMode | undefined)
        }
        className="font-mono text-[11px] bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 w-fit"
      >
        <option value="">—</option>
        <option value="remote">remote</option>
        <option value="hybrid">hybrid</option>
        <option value="on-site">on-site</option>
      </select>

      <Label>Benefits</Label>
      <input
        type="text"
        value={offer.benefits ?? ""}
        onChange={(e) => set("benefits", e.target.value || undefined)}
        placeholder="health, learning budget, …"
        className="bg-transparent border border-ink/10 focus:border-ink/60 focus:outline-none px-2 py-1 placeholder:text-ink/30"
      />
    </div>
  );
}

// ———————————————————————————————————————————————
// Offer display (saved, read-only + edit toggle)
// ———————————————————————————————————————————————

function OfferDisplay({
  offer,
  onSave,
  onClear,
}: {
  offer: OfferRecord;
  onSave: (next: OfferRecord) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OfferRecord>(offer);

  const totalCash = useMemo(() => {
    const bonus = parseBonusApprox(offer.bonus, offer.baseSalary);
    const sign = offer.signOn ?? 0;
    return offer.baseSalary + bonus + sign;
  }, [offer]);

  if (editing) {
    return (
      <div className="border border-ink/10 p-5 mb-5">
        <OfferEditGrid offer={draft} onChange={setDraft} />
        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(offer);
              setEditing(false);
            }}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-ink/10 p-5 mb-5">
      <div className="grid grid-cols-[130px_1fr] gap-y-2 gap-x-5 text-sm">
        <Label>Base</Label>
        <div className="font-mono text-ink/90">
          {offer.currency} {offer.baseSalary.toLocaleString()}
        </div>
        {offer.equity && (
          <>
            <Label>Equity</Label>
            <div className="text-ink/80">{offer.equity}</div>
          </>
        )}
        {offer.bonus && (
          <>
            <Label>Bonus</Label>
            <div className="text-ink/80">{offer.bonus}</div>
          </>
        )}
        {typeof offer.signOn === "number" && (
          <>
            <Label>Sign-on</Label>
            <div className="font-mono text-ink/80">
              {offer.currency} {offer.signOn.toLocaleString()}
            </div>
          </>
        )}
        {typeof offer.ptoDays === "number" && (
          <>
            <Label>PTO</Label>
            <div className="font-mono text-ink/80">{offer.ptoDays} days</div>
          </>
        )}
        {offer.remote && (
          <>
            <Label>Mode</Label>
            <div className="font-mono text-ink/80">{offer.remote}</div>
          </>
        )}
        {offer.benefits && (
          <>
            <Label>Benefits</Label>
            <div className="text-ink/80">{offer.benefits}</div>
          </>
        )}
        <Label>Est. year-1 cash</Label>
        <div className="font-mono text-ink">
          ≈ {offer.currency} {Math.round(totalCash).toLocaleString()}
          <span className="font-sans italic text-ink/40 ml-2 text-xs">
            base + target-bonus + sign-on
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            setDraft(offer);
            setEditing(true);
          }}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              window.confirm("Discard this offer? Any analysis is also cleared.")
            ) {
              onClear();
            }
          }}
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40 hover:text-accent"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function parseBonusApprox(bonus: string | undefined, base: number): number {
  if (!bonus) return 0;
  const pct = /([\d.]+)\s*%/.exec(bonus);
  if (pct) return Math.round((Number(pct[1]) / 100) * base);
  const num = /([\d,]+)/.exec(bonus.replace(/k/i, "000"));
  if (num) return Number(num[1].replace(/,/g, ""));
  return 0;
}

// ———————————————————————————————————————————————
// Analysis
// ———————————————————————————————————————————————

function AnalysisPanel({
  app,
  onAnalysis,
}: {
  app: Application;
  onAnalysis: (analysis: SalaryAnalysis) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const analysis = app.salaryAnalysis;

  const run = useCallback(async () => {
    if (!app.offer) return;
    setBusy(true);
    setError(null);
    try {
      const baseCV = resolveBaseCV(app.cvSlug);
      const res = await trackedFetch("/api/salary/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offer: app.offer,
          parsedJob: app.jobData,
          baseCV,
          locationContext: app.jobData?.location,
        }),
      });
      const data = (await res.json()) as {
        analysis?: SalaryAnalysis;
        error?: string;
      };
      if (!res.ok || !data.analysis) {
        setError(data.error ?? "Analysis failed.");
        return;
      }
      onAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }, [app, onAnalysis]);

  const onCopy = useCallback(async () => {
    if (!analysis) return;
    try {
      await navigator.clipboard.writeText(analysis.counterOfferDraft.emailBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [analysis]);

  if (!analysis) {
    return (
      <div className="border border-ink/10 p-5">
        <p className="font-display italic text-ink/60 mb-4 leading-snug">
          Run analysis to get market context, leverage points, and a counter
          draft. Market ranges come from the model's pre-training — they are{" "}
          <span className="text-accent not-italic font-normal">approximate</span>;
          verify with levels.fyi / glassdoor / friends before replying.
        </p>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="font-mono text-[11px] uppercase tracking-[0.2em] px-4 py-2 bg-ink text-paper hover:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed"
        >
          {busy ? "Analysing…" : "Analyze offer"}
        </button>
        {error && (
          <div className="mt-3">
            <ApiKeyHint error={error} inline />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AnalysisCard title="Market context" tint="accent">
        <div className="border-l-2 border-accent/60 pl-3 mb-3 font-mono text-[11px] text-accent">
          {analysis.marketContext.confidenceNote}
        </div>
        {(analysis.marketContext.bandLow ||
          analysis.marketContext.bandMid ||
          analysis.marketContext.bandHigh) && (
          <div className="grid grid-cols-3 gap-3 my-3">
            <BandTile label="Low" value={analysis.marketContext.bandLow} />
            <BandTile label="Mid" value={analysis.marketContext.bandMid} />
            <BandTile label="High" value={analysis.marketContext.bandHigh} />
          </div>
        )}
        {analysis.marketContext.bandSource && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 mt-2">
            {analysis.marketContext.bandSource}
          </p>
        )}
      </AnalysisCard>

      <AnalysisCard title="Leverage points">
        <ul className="space-y-2">
          {analysis.leveragePoints.map((l, i) => (
            <li key={`lv-${i}`} className="text-sm text-ink/85 leading-snug flex gap-2">
              <span className="text-ink/50 shrink-0">→</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
        {analysis.risks.length > 0 && (
          <div className="mt-4 pt-4 border-t border-ink/10">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-2">
              Don't push on
            </p>
            <ul className="space-y-1.5">
              {analysis.risks.map((r, i) => (
                <li
                  key={`rk-${i}`}
                  className="text-sm text-ink/65 italic leading-snug"
                >
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AnalysisCard>

      <AnalysisCard title="Counter-offer" tint="ink">
        <p className="font-display text-xl italic text-ink leading-snug mb-3">
          {analysis.counterOfferDraft.headline}
        </p>
        <p className="text-sm text-ink/70 mb-4 leading-snug">
          {analysis.counterOfferDraft.rationale}
        </p>
        <div className="border border-ink/10 bg-paper/40">
          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink/90 p-4">
            {analysis.counterOfferDraft.emailBody}
          </pre>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={onCopy}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/70 hover:text-ink"
          >
            {copied ? "Copied" : "Copy email"}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 hover:text-ink disabled:opacity-40"
          >
            {busy ? "Regenerating…" : "Regenerate analysis"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/40 ml-auto">
            {formatDateTime(analysis.generatedAt)}
          </span>
        </div>
        {error && (
          <div className="mt-3">
            <ApiKeyHint error={error} inline />
          </div>
        )}
      </AnalysisCard>
    </div>
  );
}

function AnalysisCard({
  title,
  children,
  tint = "default",
}: {
  title: string;
  children: React.ReactNode;
  tint?: "default" | "accent" | "ink";
}) {
  const border =
    tint === "accent"
      ? "border-accent/30"
      : tint === "ink"
        ? "border-ink/30"
        : "border-ink/10";
  return (
    <div className={`border ${border} p-5`}>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink/60 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function BandTile({ label, value }: { label: string; value?: number }) {
  return (
    <div className="border border-ink/10 p-3 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/50 mb-1">
        {label}
      </div>
      <div className="font-display text-2xl text-ink/85">
        {typeof value === "number" ? value.toLocaleString() : "—"}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
      {children}
    </div>
  );
}
