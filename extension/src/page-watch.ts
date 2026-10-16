// "New page? Click Fill this page" (Apply spec, story 35): after a fill, the panel listens for the
// filled tab's address or title changing, which is how it knows Kris moved to the portal's next step.
// It only listens: Chrome includes a tab's address and title in these events only for sites the
// extension may see (the granted portals, or the tab Kris clicked the icon on), and nothing here
// reads or touches the page. One notice per fill, then it stops listening.

export interface TabEvents {
  onUpdated: {
    addListener(listener: (tabId: number, change: { url?: string; title?: string }) => void): void;
    removeListener(listener: (tabId: number, change: { url?: string; title?: string }) => void): void;
  };
}

/** Calls `onNewPage` once when the tab leaves the filled page; returns a stop function. */
export function watchForNewPage(tabs: TabEvents, page: { tabId: number; url: string; title: string | undefined }, onNewPage: () => void): () => void {
  const listener = (tabId: number, change: { url?: string; title?: string }) => {
    if (tabId !== page.tabId) return;
    const moved = (change.url !== undefined && change.url !== page.url) || (change.title !== undefined && change.title !== page.title);
    if (!moved) return;
    stop();
    onNewPage();
  };
  const stop = () => tabs.onUpdated.removeListener(listener);
  tabs.onUpdated.addListener(listener);
  return stop;
}
