// Requirement chips, shared by Feed rows and the Job page. Rules (DESIGN.md, Discover review):
// every gap and partly-met requirement is shown; only met items collapse into "+N met"; preferred
// items are never gaps. Without a master profile nothing can be met or missing, so required items
// show as "not checked" and are never collapsed; preferred ones collapse into "+N preferred".
import type { FeedJob, RequirementStatus } from "@apply-kit/core";
import { Icon, type IconName } from "./icons.tsx";

const chipFor: Record<RequirementStatus, { cls: string; icon: IconName; sr: string }> = {
  met: { cls: "met", icon: "met", sr: "met" },
  partly: { cls: "partly", icon: "partly", sr: "partly met" },
  gap: { cls: "gap", icon: "gap", sr: "missing" },
  "not-held": { cls: "partly", icon: "partly", sr: "preferred, not held, not a gap" },
  unknown: { cls: "neutral", icon: "unknown", sr: "not checked yet" },
};

export function StatusChip({ status, label }: { status: RequirementStatus; label: string }) {
  const c = chipFor[status];
  return (
    <span className={`chip ${c.cls}`}>
      <Icon name={c.icon} />{label}<span className="sr-only">, {c.sr}</span>
    </span>
  );
}

export function AskChip({ label }: { label: string }) {
  return <span className="chip ask"><Icon name="ask" />{label}</span>;
}

const readingChip: Partial<Record<FeedJob["reading"], string>> = {
  unread: "Not read yet",
  reading: "Reading the posting…",
  failed: "Couldn't read the posting",
  unscreened: "Unscreened · AI budget reached",
};

/** The chips for one Feed row. */
export function RowChips({ job }: { job: FeedJob }) {
  const pending = readingChip[job.reading];
  if (pending) return <div className="chips"><span className="chip neutral">{pending}</span></div>;
  if (job.requirements.length === 0 && job.needsYou === 0) {
    return <div className="chips"><span className="chip neutral">No requirements listed</span></div>;
  }
  const r = job.requirements;
  const shown = [
    ...r.filter((x) => x.status === "gap"),
    ...r.filter((x) => x.status === "partly"),
    ...r.filter((x) => x.status === "unknown" && x.kind === "required"),
  ];
  const met = r.filter((x) => x.status === "met").length;
  const preferredUnknown = r.filter((x) => x.status === "unknown" && x.kind === "preferred").length;
  return (
    <div className="chips">
      {shown.map((x, i) => <StatusChip key={i} status={x.status} label={x.text} />)}
      {met > 0 && <span className="chip met"><Icon name="met" />{met === r.length ? `All ${met} met` : `+${met} met`}</span>}
      {preferredUnknown > 0 && <span className="chip neutral">+{preferredUnknown} preferred</span>}
      {job.needsYou > 0 && <AskChip label={`${job.needsYou} ${job.needsYou === 1 ? "fact needs" : "facts need"} you`} />}
    </div>
  );
}
