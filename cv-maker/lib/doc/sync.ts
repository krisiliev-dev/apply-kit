"use client";

import type { CvDocument } from "./types";

// Client helpers to mirror the editor's document to the shared server store
// (so the MCP bridge / another tab can read it) and to pull external changes
// back. Best-effort: any network failure is swallowed — localStorage remains
// the offline source of truth.

export async function fetchServerDoc(slug: string): Promise<CvDocument | null> {
  try {
    const res = await fetch(`/api/docs/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { doc?: CvDocument };
    return data.doc ?? null;
  } catch {
    return null;
  }
}

export async function pushServerDoc(doc: CvDocument): Promise<void> {
  try {
    await fetch(`/api/docs/${encodeURIComponent(doc.slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc }),
    });
  } catch {
    // offline / route missing — ignore, localStorage still has it
  }
}
