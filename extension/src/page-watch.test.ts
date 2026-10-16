// "New page?": after a fill, the panel notices the tab's address or title changing (Workday moving to
// its next step) and moves the list under Earlier pages. Tested with a fake tabs API: the panel only
// listens; it never reads the page.
import { describe, expect, it } from "vitest";
import { watchForNewPage, type TabEvents } from "./page-watch.ts";

type Listener = Parameters<TabEvents["onUpdated"]["addListener"]>[0];
function fakeTabs() {
  const listeners = new Set<Listener>();
  return {
    tabs: { onUpdated: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) } } satisfies TabEvents,
    update: (tabId: number, change: { url?: string; title?: string; status?: string }) => { for (const l of [...listeners]) l(tabId, change); },
    count: () => listeners.size,
  };
}
const filledPage = { tabId: 7, url: "https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply/applyManually", title: "My Information" };

describe("noticing a new page after a fill", () => {
  it("says so once when the filled tab's address changes, then stops listening", () => {
    const t = fakeTabs();
    const seen: string[] = [];
    watchForNewPage(t.tabs, filledPage, () => seen.push("new page"));

    t.update(7, { url: `${filledPage.url}?step=2` });
    t.update(7, { url: `${filledPage.url}?step=3` });

    expect(seen).toEqual(["new page"]);
    expect(t.count()).toBe(0);
  });

  it("notices a title change too (Workday moves between steps without a new address)", () => {
    const t = fakeTabs();
    const seen: string[] = [];
    watchForNewPage(t.tabs, filledPage, () => seen.push("new page"));
    t.update(7, { title: "My Experience" });
    expect(seen).toEqual(["new page"]);
  });

  it("ignores other tabs, loading noise, the same address and title, and changes Chrome doesn't show it (no host access)", () => {
    const t = fakeTabs();
    const seen: string[] = [];
    watchForNewPage(t.tabs, filledPage, () => seen.push("new page"));

    t.update(8, { url: "https://example.com/" });
    t.update(7, { status: "loading" });
    t.update(7, { url: filledPage.url, title: filledPage.title });

    expect(seen).toEqual([]);
    expect(t.count()).toBe(1);
  });

  it("can be stopped (another fill on the same tab starts a new watch)", () => {
    const t = fakeTabs();
    const seen: string[] = [];
    const stop = watchForNewPage(t.tabs, filledPage, () => seen.push("new page"));
    stop();
    t.update(7, { title: "My Experience" });
    expect(seen).toEqual([]);
  });
});
