"use client";

import type { DiscoveryPreferences, JobPosting } from "./types";

// Client helpers bridging the /discover UI to the shared server store, so the
// MCP-driven discovery (sources the agent registered, postings it crawled)
// shows up in the browser and vice versa. Best-effort — failures fall back to
// the existing localStorage-only behaviour.

export async function pullServerPrefs(): Promise<DiscoveryPreferences | null> {
  try {
    const res = await fetch("/api/discover/prefs", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { prefs?: DiscoveryPreferences };
    return data.prefs ?? null;
  } catch {
    return null;
  }
}

export async function pushServerPrefs(prefs: DiscoveryPreferences): Promise<void> {
  try {
    await fetch("/api/discover/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
    });
  } catch {
    // offline — localStorage copy still applies
  }
}

export async function pullServerPostings(): Promise<JobPosting[]> {
  try {
    const res = await fetch("/api/discover/postings", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { postings?: JobPosting[] };
    return data.postings ?? [];
  } catch {
    return [];
  }
}

export type RunDiscoveryResult = {
  fetched: number;
  added: number;
  total: number;
  errors: Array<{ sourceKey: string; message: string }>;
};

export async function runServerDiscovery(): Promise<RunDiscoveryResult> {
  const res = await fetch("/api/discover/run", { method: "POST" });
  const data = (await res.json()) as RunDiscoveryResult & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? `Run failed (${res.status}).`);
  return data;
}
