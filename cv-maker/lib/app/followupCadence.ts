// Follow-up cadence heuristics.
// Given a status change on an application, stage the appropriate FollowUp
// records (kind + scheduled time). No AI calls — purely deterministic.
//
// Cadence rules:
// - post-apply: +7 days after dateCreated (staged when status becomes "applied").
// - post-screen: +3 days after status change to "screen".
// - post-interview: +2 days after status change to "interview".
// - post-offer: +1 day after status change to "offer".
//
// Idempotency: we never stage two follow-ups of the same kind for an
// application unless the earlier one is already sent/skipped. The caller
// should dedupe via `status === "pending"`.

import { nanoid } from "nanoid";
import type {
  Application,
  ApplicationStatus,
  FollowUp,
  FollowUpKind,
} from "./types";
import {
  loadFollowUpsFromStorage,
  saveFollowUpsToStorage,
} from "./followupPersist";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CadenceRule = {
  kind: FollowUpKind;
  offsetDays: number;
  triggerStatus?: ApplicationStatus;
  /** If set, use dateCreated rather than the status-change time. */
  anchor: "dateCreated" | "now";
};

export const CADENCE_RULES: CadenceRule[] = [
  {
    kind: "post-apply",
    offsetDays: 7,
    triggerStatus: "applied",
    anchor: "dateCreated",
  },
  {
    kind: "post-screen",
    offsetDays: 3,
    triggerStatus: "screen",
    anchor: "now",
  },
  {
    kind: "post-interview",
    offsetDays: 2,
    triggerStatus: "interview",
    anchor: "now",
  },
  {
    kind: "post-offer",
    offsetDays: 1,
    triggerStatus: "offer",
    anchor: "now",
  },
];

export function scheduleFor(rule: CadenceRule, app: Application, now: number): number {
  if (rule.anchor === "dateCreated") {
    return app.dateCreated + rule.offsetDays * DAY_MS;
  }
  return now + rule.offsetDays * DAY_MS;
}

/**
 * Called by the Zustand store whenever an application's status changes.
 * Side-effect: appends new pending FollowUp rows into localStorage, skipping
 * any kind that already has a pending row for this application.
 */
export function autoStageFollowUpsForStatus(
  app: Application,
  _prevStatus: ApplicationStatus | undefined,
  nextStatus: ApplicationStatus,
): void {
  if (typeof window === "undefined") return;
  const rule = CADENCE_RULES.find((r) => r.triggerStatus === nextStatus);
  if (!rule) return;

  const existing = loadFollowUpsFromStorage();
  const alreadyPending = existing.some(
    (f) =>
      f.applicationId === app.id && f.kind === rule.kind && f.status === "pending",
  );
  if (alreadyPending) return;

  const fu: FollowUp = {
    id: nanoid(10),
    applicationId: app.id,
    kind: rule.kind,
    scheduledFor: scheduleFor(rule, app, Date.now()),
    status: "pending",
  };
  saveFollowUpsToStorage([...existing, fu]);

  // Cross-tab signal: followupStore listens and refreshes itself.
  try {
    window.dispatchEvent(new CustomEvent("cv-maker:followups-changed"));
  } catch {
    // ignore
  }
}

/**
 * For existing applications (seeded fixtures, or created before the feature
 * shipped) we derive the post-apply row the first time a tracker page mounts.
 * This is a best-effort backfill — callers should only call once per load.
 */
export function backfillMissingPostApply(apps: Application[]): FollowUp[] {
  if (typeof window === "undefined") return [];
  const existing = loadFollowUpsFromStorage();
  const existingByApp = new Set(
    existing
      .filter((f) => f.status === "pending")
      .map((f) => `${f.applicationId}:${f.kind}`),
  );
  const added: FollowUp[] = [];
  for (const app of apps) {
    if (app.status === "draft") continue;
    const key = `${app.id}:post-apply`;
    if (existingByApp.has(key)) continue;
    added.push({
      id: nanoid(10),
      applicationId: app.id,
      kind: "post-apply",
      scheduledFor: app.dateCreated + 7 * DAY_MS,
      status: "pending",
    });
  }
  if (added.length > 0) {
    saveFollowUpsToStorage([...existing, ...added]);
    try {
      window.dispatchEvent(new CustomEvent("cv-maker:followups-changed"));
    } catch {
      // ignore
    }
  }
  return added;
}

export const FOLLOWUP_KIND_LABEL: Record<FollowUpKind, string> = {
  "post-apply": "Post-apply nudge",
  "post-screen": "After-screen thanks",
  "post-interview": "After-interview thanks",
  "post-offer": "Offer response reminder",
  custom: "Custom",
};

export const FOLLOWUP_KIND_TONE: Record<FollowUpKind, string> = {
  "post-apply":
    "Light, single paragraph. Re-flags interest without pressuring. 70–110 words.",
  "post-screen":
    "Warm thank-you after a screen call. Reference one concrete topic from the conversation (the user will add specifics). Confirm continued interest. 90–130 words.",
  "post-interview":
    "Stronger thank-you after a loop. Specific to the technical or strategic topics discussed. Invite next step. 100–150 words.",
  "post-offer":
    "Polite reminder to the candidate (self-directed) that the offer deadline is approaching. Not an email to the company — a nudge to act.",
  custom: "Neutral professional tone. The user will provide context separately.",
};
