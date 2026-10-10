"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/doc/store";
import { loadFromStorage, saveToStorage } from "@/lib/doc/persist";
import { fetchServerDoc, pushServerDoc } from "@/lib/doc/sync";
import { seedFor } from "@/lib/doc/seed";
import type { CvDocument } from "@/lib/doc/types";

// Loads the document for `slug` on mount and persists changes. Persistence is
// two-tier:
//   • localStorage — instant, offline source of truth (unchanged behaviour).
//   • shared server store (/api/docs) — mirror so the MCP bridge / another tab
//     can read & rework the same CV. On mount we reconcile with the server;
//     a poll surfaces external (agent) edits via a reload banner.
//
// Loop-safety: the poll only flags a change when the server's updatedAt is
// strictly NEWER than the doc currently loaded. Our own mirror writes carry
// the current doc's updatedAt, so they never look "newer" than what we hold.

const SERVER_PUSH_DEBOUNCE_MS = 600;
const POLL_INTERVAL_MS = 4000;

export function usePersist(slug: string) {
  const loadedRef = useRef(false);
  const [externalDoc, setExternalDoc] = useState<CvDocument | null>(null);

  // Mount: load local/seed immediately, then reconcile with the server store.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const existing = loadFromStorage(slug);
    useEditor.getState().loadDoc(existing ?? seedFor(slug));
    useEditor.temporal.getState().clear();

    // A blank seed for a brand-new slug has a fresh updatedAt but no real
    // content, so compare the server against LOCAL (not the seed): if there's
    // no local doc, any server doc wins.
    const localUpdatedAt = existing?.updatedAt ?? -1;
    void (async () => {
      const server = await fetchServerDoc(slug);
      if (!server) return;
      if (server.updatedAt > localUpdatedAt) {
        useEditor.getState().loadDoc(server);
        useEditor.temporal.getState().clear();
        saveToStorage(server);
      }
    })();
  }, [slug]);

  // Save: localStorage immediately, server mirror debounced.
  useEffect(() => {
    let lastSaved = 0;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((state) => {
      if (!loadedRef.current) return;
      if (state.doc.updatedAt === lastSaved) return;
      lastSaved = state.doc.updatedAt;
      saveToStorage(state.doc);
      const snapshot = state.doc;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        void pushServerDoc(snapshot);
      }, SERVER_PUSH_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (pushTimer) clearTimeout(pushTimer);
    };
  }, []);

  // Poll for external (agent / other-tab) edits.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      const server = await fetchServerDoc(slug);
      if (cancelled || !server) return;
      if (server.updatedAt > useEditor.getState().doc.updatedAt) {
        setExternalDoc(server);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  const applyExternal = useCallback(() => {
    setExternalDoc((doc) => {
      if (doc) {
        useEditor.getState().loadDoc(doc);
        useEditor.temporal.getState().clear();
        saveToStorage(doc);
      }
      return null;
    });
  }, []);

  const dismissExternal = useCallback(() => setExternalDoc(null), []);

  return { externalDoc, applyExternal, dismissExternal };
}
