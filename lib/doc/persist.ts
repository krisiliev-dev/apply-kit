"use client";

import type { CvDocument } from "./types";

// Per-slug localStorage persistence. Keep it dumb and JSON-serializable.
const keyFor = (slug: string) => `cv-maker:doc:${slug}`;

export function loadFromStorage(slug: string): CvDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(slug));
    if (!raw) return null;
    return JSON.parse(raw) as CvDocument;
  } catch {
    return null;
  }
}

export function saveToStorage(doc: CvDocument) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(doc.slug), JSON.stringify(doc));
  } catch {
    // ignore quota errors for now; images as data URLs could push us over.
  }
}

export function clearStorage(slug: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyFor(slug));
}
