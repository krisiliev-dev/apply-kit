"use client";

// ————————————————————————————————————————————————
// Shared error display for "provider key is missing" failures.
//
// Every AI route in the app (Anthropic-backed) and the Affinda-backed eval
// path return a 400 JSON body with `{ error: "...API_KEY missing..." }` when
// the key is absent at runtime. Use this component to surface that condition
// consistently wherever we `fetch()` one of those routes.
//
// Usage:
//   const [err, setErr] = useState<string|null>(null);
//   ...
//   <ApiKeyHint error={err} />
//
// Or pass the error string directly:
//   <ApiKeyHint error={data.error ?? null} />
// ————————————————————————————————————————————————

export type ApiKeyHintProps = {
  /** Raw error string — can be null / undefined / any message. */
  error?: string | null;
  /** Optional inline variant (no card, just a line of text). */
  inline?: boolean;
  /** Force a specific provider label in the message. */
  provider?: "anthropic" | "affinda";
  /** Custom extra class names. */
  className?: string;
};

/** Returns true when the given error string looks like a missing-API-key 400. */
export function isApiKeyMissing(error: string | null | undefined): boolean {
  if (!error) return false;
  return /API_KEY/i.test(error) && /missing|not set/i.test(error);
}

/** Narrow an error to a specific provider hint — falls back to a generic one. */
function detectProvider(
  error: string | null | undefined,
  explicit?: "anthropic" | "affinda",
): "anthropic" | "affinda" | "generic" {
  if (explicit) return explicit;
  if (!error) return "generic";
  if (/ANTHROPIC/i.test(error)) return "anthropic";
  if (/AFFINDA/i.test(error)) return "affinda";
  return "generic";
}

export function ApiKeyHint({
  error,
  inline,
  provider,
  className,
}: ApiKeyHintProps) {
  if (!error) return null;
  if (!isApiKeyMissing(error)) {
    // Non-key errors — still render as a muted error line so callers can
    // use this one component for both cases.
    return (
      <p
        className={`font-mono text-[11px] text-accent ${className ?? ""}`.trim()}
      >
        {error}
      </p>
    );
  }

  const p = detectProvider(error, provider);
  const envVar =
    p === "affinda" ? "AFFINDA_API_KEY" : "ANTHROPIC_API_KEY";
  const valueHint =
    p === "affinda" ? "<your key>" : "sk-ant-…";

  if (inline) {
    return (
      <span
        className={`font-mono text-[11px] text-ink/60 ${className ?? ""}`.trim()}
      >
        Add <code>{envVar}</code> to <code>.env.local</code> and restart.
      </span>
    );
  }

  return (
    <div
      role="alert"
      className={`border border-accent/30 bg-accent/10 px-3 py-2 ${className ?? ""}`.trim()}
    >
      <p className="font-mono text-[11px] text-accent">
        {p === "affinda" ? "Affinda" : "Anthropic"} API key missing.
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink/70">
        Add{" "}
        <code>
          {envVar}={valueHint}
        </code>{" "}
        to <code>.env.local</code> and restart the dev server.
      </p>
    </div>
  );
}
