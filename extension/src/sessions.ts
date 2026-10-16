// Which fill session each tab is in (Apply spec: "Session per tab"). The only fill state the
// extension keeps in the browser, in session storage (cleared when Chrome closes): tab id → session
// id. The package, the profile and the page stay in apply-kit.

/** The slice of the browser's session storage used here. */
export interface SessionStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface TabSessions {
  get(tabId: number): Promise<string | null>;
  set(tabId: number, sessionId: string): Promise<void>;
  clear(tabId: number): Promise<void>;
}

export function createTabSessions(store: SessionStore): TabSessions {
  const key = (tabId: number) => `fill-session:${tabId}`;
  return {
    async get(tabId) {
      const v = (await store.get([key(tabId)]))[key(tabId)];
      return typeof v === "string" ? v : null;
    },
    set: (tabId, sessionId) => store.set({ [key(tabId)]: sessionId }),
    clear: (tabId) => store.remove([key(tabId)]),
  };
}
