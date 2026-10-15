// Shared parts of Setup (hi-fi: docs/design/hifi/onboarding.html): the four steps as links, in-page
// navigation between them, and the words for where Kris stopped.
import type { SetupProgress, SetupStep } from "@apply-kit/core";
import { createContext, useContext, type MouseEvent } from "react";
import { Icon } from "../icons.tsx";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const usd = (n: number) => `$${n.toFixed(2)}`;
/** The day this month's AI budget resets: "1 Nov". */
export function resetDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Moves between Setup's steps without a page load; Back and Forward work as usual. */
export type Go = (path: string) => void;

export interface SetupContextValue {
  progress: SetupProgress | null;
  go: Go;
  announce: (msg: string) => void;
  /** Reads where Kris is again (counts change as pieces are checked). */
  refresh: () => void;
}
export const SetupContext = createContext<SetupContextValue>({ progress: null, go: () => {}, announce: () => {}, refresh: () => {} });
export const useSetup = () => useContext(SetupContext);

/** A real link that Setup follows in place (a modified click still opens a new tab). */
export function useNavLink() {
  const { go } = useSetup();
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go(e.currentTarget.getAttribute("href")!);
  };
}

export const stepPath: Record<SetupStep, string> = {
  import: "/setup/import", review: "/setup/review", interview: "/setup/interview", search: "/setup/search", done: "/setup/done",
};
const order: SetupStep[] = ["import", "review", "interview", "search", "done"];

/**
 * The four setup steps as links, in order; the current one is marked, earlier ones are done. Each
 * says where it stands in words as well as by its icon's shape (never colour alone).
 */
export function Steps({ current, reading = false, imported = null }: {
  current: Exclude<SetupStep, "done">;
  /** The import is reading files (its step shows a spinner). */
  reading?: boolean;
  /** Pieces the last import drafted, for the Import step's sub-label. */
  imported?: number | null;
}) {
  const { progress } = useSetup();
  const nav = useNavLink();
  const c = progress?.counts;
  const at = order.indexOf(current);
  const steps: { step: SetupStep; label: string; sub: (state: "done" | "current" | "upcoming") => string }[] = [
    { step: "import", label: "Import", sub: (s) => (s === "current" ? (reading ? "Reading…" : "Old CVs, LinkedIn") : s === "done" && imported != null ? plural(imported, "piece", "pieces") : "Old CVs, LinkedIn") },
    { step: "review", label: "Check drafts", sub: (s) => (!c || c.pieces === 0 ? "Confirm or fix" : s === "current" ? `${c.confirmed} of ${c.pieces}` : s === "done" ? `${c.confirmed} confirmed` : "Confirm or fix") },
    { step: "interview", label: "Interview", sub: (s) => (s === "done" ? "With the coach" : "About 15 min") },
    { step: "search", label: "Your search", sub: () => "Check defaults" },
  ];
  return (
    <nav aria-label="Setup steps">
      <ol className="pk-steps">
        {steps.map(({ step, label, sub }, i) => {
          const state = i < at ? "done" : i === at ? "current" : "upcoming";
          const working = state === "current" && reading;
          return (
            <li key={step} className={`${state}${working ? " working" : ""}`}>
              <a href={stepPath[step]} onClick={nav} aria-current={state === "current" ? "step" : undefined}>
                <span className="ic" aria-hidden="true">{working ? <span className="spin" /> : state === "done" ? <Icon name="met" /> : i + 1}</span>
                <span className="lbl">{label}</span>
                <span className="sub">{sub(state)}<span className="sr-only">{state === "done" ? ", done" : ""}</span></span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** "yesterday at 21:40", "today at 09:05", or "on 3 Oct at 18:20". */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} at ${time}`;
}
