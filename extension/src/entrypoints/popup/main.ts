// The capture panel. Opening it on a tab is what lets it read that tab (activeTab); clicking Capture
// reads the page once, asks apply-kit what it would add, and only "Add" stores anything (in apply-kit,
// never here). The page read is held in this panel's memory until it closes.
import { browser } from "wxt/browser";
import type { CaptureReport, CapturedPage } from "@apply-kit/core";
import "../../../../app/ui/src/styles/tokens.css";
import "../../../../app/ui/src/styles/components.css";
import "./popup.css";
import { grabPage } from "../../grab.ts";
import { actionLabel, captureButtonLabel, itemStatus, previewHeading, resultSummary } from "../../report.ts";
import { createClient, defaultServiceUrl, type Connection } from "../../service.ts";

const app = document.getElementById("app")!;
const client = createClient({ fetch: (input, init) => fetch(input, init), store: browser.storage.local });
const retryMs = 10_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

type Child = Node | string | null | false | undefined;
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}
function button(label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}
function show(...children: Child[]) {
  app.replaceChildren(h("header", { class: "popup-head" }, h("span", { class: "brand" }, "apply-kit")), ...children.filter((c): c is Node | string => !!c));
}
const boundary = () => h("p", { class: "meta" }, "apply-kit reads only the page you have open, when you click. It never scrolls, clicks or opens listings for you.");

async function start() {
  if (retryTimer) clearTimeout(retryTimer);
  show(h("p", { class: "meta" }, "Looking for apply-kit on this laptop…"));
  const connection = await client.connect();
  if (connection.state === "not-running") return notRunning(connection);
  if (connection.state === "unpaired") return unpaired(connection);
  return ready(connection);
}

function notRunning(c: Connection, during?: string) {
  show(
    h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" },
      h("b", {}, "Can't reach apply-kit on this laptop. "),
      "Start apply-kit (or check it's still running), then retry.",
    )),
    h("p", { class: "meta" }, during ?? "Nothing on this page has been read, and the extension keeps nothing of its own.", ` Retrying every ${retryMs / 1000} s at ${c.serviceUrl}.`),
    button("Retry", () => void start()),
  );
  retryTimer = setTimeout(() => void start(), retryMs);
}

function unpaired(c: Connection, error?: string) {
  const code = h("input", { id: "code", class: "input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", "aria-describedby": "code-help" }) as HTMLInputElement;
  const address = h("input", { id: "address", class: "input", value: c.serviceUrl, spellcheck: "false" }) as HTMLInputElement;
  const pair = async () => {
    const result = await client.pair(code.value, address.value || defaultServiceUrl);
    if (result.ok) return start();
    unpaired({ ...c, serviceUrl: address.value || c.serviceUrl }, result.error);
  };
  const form = h("form", { class: "stack" },
    h("h1", {}, "Pair with apply-kit"),
    h("div", { class: "field" },
      h("label", { for: "code" }, "Pairing code"),
      code,
      h("span", { id: "code-help", class: "help" }, "In apply-kit, open Settings and choose Pair the extension. Type the 6-digit code it shows."),
      error && h("span", { class: "err", role: "alert" }, error),
    ),
    h("details", {}, h("summary", { class: "meta" }, "Service address"), h("div", { class: "field" }, h("label", { for: "address" }, "apply-kit runs at"), address)),
    h("button", { type: "submit", class: "btn primary" }, "Pair"),
  );
  form.addEventListener("submit", (e) => { e.preventDefault(); void pair(); });
  show(form);
  code.focus();
}

async function currentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ready(c: Connection) {
  const tab = await currentTab();
  show(
    h("h1", {}, "Capture into your Feed"),
    boundary(),
    button(captureButtonLabel(tab?.url), () => void capture(c), "btn primary"),
  );
}

/** Reads the open tab once, as rendered right now. */
async function readTab(): Promise<CapturedPage | null> {
  const tab = await currentTab();
  if (tab?.id == null) return null;
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: grabPage });
    return (res?.result as CapturedPage | undefined) ?? null;
  } catch {
    return null;
  }
}

async function capture(c: Connection) {
  show(h("p", { class: "meta" }, "Reading this page…"));
  const page = await readTab();
  if (!page) {
    return show(h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, "Chrome doesn't let extensions read this page (its own pages and the Web Store are off limits).")), button("Back", () => void start()));
  }
  const answer = await client.preview(page);
  if (!answer.ok) return problem(c, answer);
  preview(c, page, answer.report);
}

function problem(c: Connection, answer: { state: string; error?: string }) {
  if (answer.state === "not-running") return notRunning(c, "The page wasn't sent: apply-kit stopped answering.");
  if (answer.state === "unpaired") return unpaired(c, "apply-kit no longer knows this extension. Pair it again.");
  show(h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, answer.error ?? "Something went wrong.")), button("Back", () => void start()));
}

function listOf(r: CaptureReport) {
  return h("ul", { class: "listings" }, ...r.listings.map((l) => h("li", { class: `listing ${l.status}` },
    h("span", { class: "title" }, l.title ?? "Untitled card"),
    h("span", { class: "meta" }, [l.company, l.location].filter(Boolean).join(" · ") || "No company or location shown"),
    h("span", { class: `chip ${chipFor(l.status)}` }, itemStatus(l)),
  )));
}
const chipFor = (s: string) => (s === "new" ? "met" : s === "hidden" ? "hidden-reason" : s === "unreadable" ? "gap" : "neutral");

function preview(c: Connection, page: CapturedPage, r: CaptureReport) {
  if (r.kind === "none") {
    return show(h("h1", {}, previewHeading(r)), h("p", {}, r.message ?? ""), boundary(), button("Back", () => void start()));
  }
  const readable = r.counts.new + r.counts.inFeed + r.counts.hidden;
  show(
    h("h1", {}, previewHeading(r)),
    h("p", { class: "meta" }, `Read from the ${r.site} page you have open. Nothing else was opened.`),
    h("p", { class: "summary" }, resultSummary(r, "preview")),
    listOf(r),
    h("div", { class: "actions" },
      readable > 0 && button(actionLabel(r), () => void add(c, page), "btn primary"),
      button("Cancel", () => void start(), "btn ghost"),
    ),
    r.counts.hidden > 0 && h("p", { class: "meta" }, "Hidden jobs are saved to the hidden pile with their reason, so a wrong dealbreaker can be undone."),
    r.kind === "search" && h("p", { class: "meta" }, "Want more? Scroll or open the next page yourself, then capture again."),
  );
}

async function add(c: Connection, page: CapturedPage) {
  show(h("p", { class: "meta" }, "Adding to your Feed…"));
  const answer = await client.capture(page);
  if (!answer.ok) return problem(c, answer);
  const r = answer.report;
  show(
    h("div", { class: "banner success", role: "status" }, h("div", { class: "text" }, resultSummary(r, "done") || "Nothing to add")),
    listOf(r),
    h("p", { class: "meta" }, `Source: ${r.source ?? r.site}. Each job is re-checked on the company's own job system where apply-kit has one; otherwise it shows "unverified" after 30 days and stays in the Feed.`),
    h("div", { class: "actions" },
      h("a", { class: "btn primary", href: c.serviceUrl, target: "_blank", rel: "noopener" }, "Open the Feed"),
      button("Done", () => window.close(), "btn ghost"),
    ),
    r.kind === "search" && h("p", { class: "meta" }, "Want more? Scroll or open the next page yourself, then capture again."),
  );
}

void start();
