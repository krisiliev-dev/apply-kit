// apply-kit's side panel (ADR 0005): one panel, two views, Fill this application and Capture, switched
// in place. It's opened from the toolbar icon or the "Fill this page" command, which is also what lets
// it read the tab Kris is on (activeTab), unless Kris allowed the six portals. Capture reads the page
// once on a click, asks apply-kit what it would add, and only "Add" stores anything (in apply-kit,
// never here). Fill, for now, recognises the portal and the job from the tab's address and fills
// nothing. The panel follows the tab Kris looks at only to update what it says; it never reads or
// touches a page by itself.
import { browser } from "wxt/browser";
import type { CaptureReport, CapturedPage } from "@apply-kit/core";
import "../../../../app/ui/src/styles/tokens.css";
import "../../../../app/ui/src/styles/components.css";
import "./panel.css";
import { contextCard, fillStateFor, openingView, type PanelView, type PortalsAccess } from "../../context.ts";
import { grabPage } from "../../grab.ts";
import { portalOrigins, portals, recognisePortal } from "../../portal.ts";
import { actionLabel, captureButtonLabel, itemStatus, previewHeading, resultSummary } from "../../report.ts";
import { createClient, defaultServiceUrl, type Connection } from "../../service.ts";

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
function button(label: string, onClick: () => void, cls = "btn", attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls, ...attrs }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}
function svg(markup: string): HTMLElement {
  const span = h("span", { class: "ico", "aria-hidden": "true" });
  span.innerHTML = markup;
  return span;
}
const icons = {
  brand: '<svg viewBox="0 0 24 24"><path d="M2 20 9 7l4 7 3-4 6 10z" fill="var(--action)"/><circle cx="17.5" cy="5.5" r="2" fill="var(--bloom)"/></svg>',
  check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.6v3M6 8.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  dot: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.4" fill="currentColor"/></svg>',
};

// ---------- the panel frame: header, Fill / Capture switch, body, sticky footer ----------

const conn = h("span", { class: "conn", hidden: "" });
const fillTab = button("Fill this application", () => choose("fill"), "", { "aria-pressed": "false" });
const captureTab = button("Capture", () => choose("capture"), "", { "aria-pressed": "false" });
const modes = h("div", { class: "sp-modes", hidden: "" }, h("div", { class: "segmented", role: "group", "aria-label": "Panel view" }, fillTab, captureTab));
const body = h("main", { class: "sp-body", id: "main" });
const foot = h("footer", { class: "sp-foot" });
const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
document.getElementById("app")!.replaceChildren(
  h("header", { class: "sp-head" }, h("span", { class: "brand" }, svg(icons.brand), "apply-kit"), conn),
  modes, body, foot, live,
);
// The sticky footer must never cover the focused control (WCAG 2.4.11): scroll padding = its height.
new ResizeObserver(() => document.documentElement.style.setProperty("--foot-h", `${foot.offsetHeight}px`)).observe(foot);

function show({ connected, body: b, foot: f }: { connected: boolean | null; body: Child[]; foot: Child[] }) {
  conn.hidden = connected === null;
  conn.className = connected ? "conn" : "conn off";
  conn.replaceChildren(h("i", {}), connected ? "Connected" : "Not connected");
  modes.hidden = connected !== true;
  body.replaceChildren(...b.filter((c): c is Node | string => !!c));
  foot.replaceChildren(...f.filter((c): c is Node | string => !!c));
}
function announce(message: string) {
  live.textContent = "";
  setTimeout(() => (live.textContent = message), 60);
}
const fillBoundary = () => h("p", { class: "bound" }, "Fills only when you click. Never presses Next or Submit.");
const captureBoundary = () => h("p", { class: "bound" }, "apply-kit reads only the page you have open, when you click. It never scrolls, clicks or opens listings for you.");

// ---------- connection: not running, pairing, ready ----------

/** The view Kris picked with the switch; until then the panel opens on the view that suits the tab. */
let chosen: PanelView | null = null;
/** What the Fill view showed last, so the keyboard command only "fills" on a portal. */
let fillShown: ReturnType<typeof fillStateFor> | null = null;
/** Set while Capture shows a preview or result, so following the tab doesn't throw it away. */
let busy = false;
let connection: Connection | null = null;

async function start() {
  if (retryTimer) clearTimeout(retryTimer);
  busy = false;
  connection = await client.connect();
  if (connection.state === "not-running") return notRunning(connection);
  if (connection.state === "unpaired") return unpaired(connection);
  return ready();
}

function notRunning(c: Connection, during?: string) {
  connection = c;
  const time = new Date().toLocaleTimeString("en-GB");
  show({
    connected: false,
    body: [
      h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" },
        h("b", {}, "Can't reach apply-kit on this laptop."),
        " The extension gets your package from the app, and the app isn't answering.",
      )),
      h("ol", { class: "steps" }, h("li", {}, h("div", {}, "Start apply-kit, or check it's still running.")), h("li", {}, h("div", {}, "Press Retry. Your place on this page is kept."))),
      h("p", { class: "meta", role: "status" }, `Retrying every ${retryMs / 1000} s · last try ${time} · ${c.serviceUrl}`),
      h("p", { class: "meta" }, during ?? "This page hasn't been touched. Packages aren't kept in the browser, so there's nothing to fill or capture into until the app is back."),
    ],
    foot: [button("Retry", () => void start(), "btn primary")],
  });
  retryTimer = setTimeout(() => void start(), retryMs);
}

function unpaired(c: Connection, error?: string) {
  connection = c;
  const code = h("input", { id: "code", class: "input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "123 456", "aria-describedby": error ? "code-help code-err" : "code-help" }) as HTMLInputElement;
  if (error) code.setAttribute("aria-invalid", "true");
  const address = h("input", { id: "address", class: "input", value: c.serviceUrl, spellcheck: "false" }) as HTMLInputElement;
  const pair = async () => {
    const result = await client.pair(code.value, address.value || defaultServiceUrl);
    if (result.ok) {
      announce("Paired. Looking at this page…");
      return start();
    }
    unpaired({ ...c, serviceUrl: address.value || c.serviceUrl }, result.error);
  };
  const form = h("form", { class: "stack form" },
    h("div", { class: "lead-h" },
      h("h1", {}, "Pair with apply-kit"),
      h("p", { class: "muted" }, "The extension gets your package from the apply-kit app on this laptop. Pair it once and it can fill portals and capture jobs."),
    ),
    h("div", { class: "field" },
      h("label", { for: "code" }, "Pairing code"),
      h("span", { id: "code-help", class: "help" }, "In apply-kit, open Settings and choose Pair the extension. Type the 6-digit code it shows."),
      code,
      error && h("span", { id: "code-err", class: "err", role: "alert" }, error),
    ),
    h("details", {}, h("summary", { class: "meta" }, "Service address"), h("div", { class: "field" }, h("label", { for: "address" }, "apply-kit runs at"), address)),
    h("button", { type: "submit", class: "btn primary" }, "Pair"),
  );
  form.addEventListener("submit", (e) => { e.preventDefault(); void pair(); });
  show({ connected: null, body: [form], foot: [h("p", { class: "bound" }, "Nothing on this page has been read. The extension keeps only the pairing token, never your profile or package.")] });
  code.focus();
}

async function ready() {
  const tab = await currentTab();
  return (chosen ?? openingView(recognisePortal(tab?.url))) === "fill" ? fill(tab) : captureStart(tab);
}

function choose(next: PanelView) {
  chosen = next;
  if (connection?.state === "ready") void ready();
}

async function currentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function pressed(v: PanelView) {
  fillTab.setAttribute("aria-pressed", String(v === "fill"));
  captureTab.setAttribute("aria-pressed", String(v === "capture"));
}

// ---------- Fill this application ----------

async function portalsAccess(): Promise<PortalsAccess> {
  if (await browser.permissions.contains({ origins: portalOrigins })) return "granted";
  const { portalsNotNow } = await browser.storage.local.get(["portalsNotNow"]);
  return portalsNotNow === true ? "not-now" : "not-asked";
}

async function shortcut(): Promise<string> {
  const commands = await browser.commands.getAll();
  return commands.find((c) => c.name === "fill-this-page")?.shortcut || "";
}

async function fill(tab: Awaited<ReturnType<typeof currentTab>>) {
  pressed("fill");
  busy = false;
  const address = tab?.url;
  const page = recognisePortal(address);
  const access = await portalsAccess();
  const state = fillStateFor({ address, page, portals: access });
  const keys = await shortcut();
  fillShown = state;

  if (state === "allow-portals") return allowPortals();
  if (state === "no-access" || state === "chrome-page") {
    return show({
      connected: true,
      body: [
        h("div", { class: "lead-h" },
          h("h1", {}, state === "chrome-page" ? "Chrome keeps this page to itself" : "apply-kit can't see this tab yet"),
          h("p", { class: "muted" }, state === "chrome-page"
            ? "Chrome doesn't let extensions read its own pages or the Web Store."
            : `Chrome shows apply-kit a tab only after you click the apply-kit icon in the toolbar${keys ? ` or press ${keys}` : ""} on it.`),
        ),
      ],
      foot: [fillBoundary()],
    });
  }

  const card = contextCard(page, { address: address!, title: tab?.title });
  const ctx = h("div", { class: "ctx" },
    h("span", { class: "where" }, card.where),
    h("h1", { class: "job" }, card.job),
    h("span", { class: "why" }, svg(state === "portal" && page.ref ? icons.check : icons.info), h("span", {}, card.why)),
  );

  if (state === "not-portal") {
    return show({
      connected: true,
      body: [ctx, h("p", {}, "Filling works on Workday, Greenhouse, Lever, SmartRecruiters, Workable and Ashby. On other forms it fills nothing unless you ask.")],
      foot: [button("Capture this job", () => choose("capture"), "btn primary"), fillBoundary()],
    });
  }

  const label = portals.find((p) => p.name === page.portal)!.label;
  show({
    connected: true,
    body: [
      ctx,
      h("div", { class: "callout" },
        h("b", {}, `Each page: click Fill, check, then continue on ${label}`),
        h("span", {}, `apply-kit fills the page you're looking at and marks every field it touched. It never presses ${label}'s buttons. When the next page shows, click Fill this page again.`),
        keys && h("span", { class: "meta" }, `Shortcut: ${keys}. Change it at chrome://extensions/shortcuts.`),
      ),
      access === "not-now" && h("div", { class: "callout" },
        h("b", {}, "Without the portals permission"),
        h("span", {}, `Click the apply-kit icon in the toolbar on each new page before filling${keys ? `, or press ${keys}` : ""}. Forms embedded in company sites can't be filled.`),
        button("Allow the 6 portals", () => requestPortals(), "btn sm"),
      ),
    ],
    foot: [button("Fill this page", () => fillThisPage(), "btn primary"), fillBoundary()],
  });
}

function allowPortals() {
  show({
    connected: true,
    body: [
      h("div", { class: "lead-h" },
        h("h1", {}, "Let apply-kit fill the portals it knows"),
        h("p", { class: "muted" }, "A one-time step. Chrome will ask you to allow apply-kit on these six job systems, so it can fill every page of an application and forms embedded in company sites."),
      ),
      h("ul", { class: "ticks" }, ...portals.map((p) => h("li", {}, svg(icons.dot), h("span", {}, `${p.label} · `, h("span", { class: "meta" }, p.hosts.join(", ")))))),
      h("div", { class: "callout" },
        h("b", {}, "What this allows, and what it doesn't"),
        h("span", {}, "apply-kit still does nothing on these sites until you click Fill. It never presses Next or Submit, never opens pages, and never sees your passwords. You can remove the permission in Chrome's extension settings at any time."),
      ),
    ],
    foot: [
      button("Allow the 6 portals", () => requestPortals(), "btn primary"),
      button("Not now", () => void notNow(), "btn ghost", { "aria-describedby": "not-now-cost" }),
      h("p", { id: "not-now-cost", class: "bound" }, "Without it, click the apply-kit icon in the toolbar on each new page before filling. Forms embedded in company sites can't be filled."),
    ],
  });
}

/** Chrome's prompt for the six portals. It must be asked straight from Kris's click, before any await. */
function requestPortals() {
  void browser.permissions.request({ origins: portalOrigins }).then(async (granted) => {
    if (granted) {
      await browser.storage.local.remove(["portalsNotNow"]);
      announce("apply-kit can now fill the six portals when you click.");
    } else {
      await browser.storage.local.set({ portalsNotNow: true });
      announce("Not allowed. Click the apply-kit icon on each new page before filling.");
    }
    void ready();
  });
}

async function notNow() {
  await browser.storage.local.set({ portalsNotNow: true });
  announce("Not now. Click the apply-kit icon on each new page before filling.");
  void ready();
}

/** The primary action of the Fill view. Filling itself isn't built yet: nothing on the page is touched. */
function fillThisPage() {
  const note = body.querySelector(".fill-note") ?? body.appendChild(h("p", { class: "fill-note meta", role: "status" }));
  note.textContent = "Nothing was filled: filling pages comes in the next apply-kit update. This page hasn't been touched.";
}

// ---------- Capture ----------

async function captureStart(tab: Awaited<ReturnType<typeof currentTab>>) {
  pressed("capture");
  fillShown = null;
  busy = false;
  show({
    connected: true,
    body: [h("div", { class: "lead-h" }, h("h1", {}, "Capture into your Feed"), h("p", { class: "muted" }, "Adds the job page, or the search results, you have open to your apply-kit Feed."))],
    foot: [button(captureButtonLabel(tab?.url), () => void capture(), "btn primary"), captureBoundary()],
  });
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

async function capture() {
  busy = true;
  show({ connected: true, body: [h("p", { class: "meta", role: "status" }, "Reading this page…")], foot: [captureBoundary()] });
  const page = await readTab();
  if (!page) {
    return show({
      connected: true,
      body: [h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, "Chrome doesn't let apply-kit read this page. Its own pages and the Web Store are off limits; on other pages, click the apply-kit icon in the toolbar first."))],
      foot: [button("Back", () => void start(), "btn primary")],
    });
  }
  const answer = await client.preview(page);
  if (!answer.ok) return problem(answer);
  preview(page, answer.report);
}

function problem(answer: { state: string; error?: string }) {
  const c = connection!;
  if (answer.state === "not-running") return notRunning(c, "The page wasn't sent: apply-kit stopped answering.");
  if (answer.state === "unpaired") return unpaired(c, "apply-kit no longer knows this extension. Pair it again.");
  show({ connected: true, body: [h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, answer.error ?? "Something went wrong."))], foot: [button("Back", () => void start(), "btn primary")] });
}

function listOf(r: CaptureReport) {
  return h("ul", { class: "listings" }, ...r.listings.map((l) => h("li", { class: `listing ${l.status}` },
    h("span", { class: "title" }, l.title ?? "Untitled card"),
    h("span", { class: "meta" }, [l.company, l.location].filter(Boolean).join(" · ") || "No company or location shown"),
    h("span", { class: `chip ${chipFor(l.status)}` }, itemStatus(l)),
  )));
}
const chipFor = (s: string) => (s === "new" ? "met" : s === "hidden" ? "hidden-reason" : s === "unreadable" ? "gap" : "neutral");

function preview(page: CapturedPage, r: CaptureReport) {
  if (r.kind === "none") {
    return show({ connected: true, body: [h("h1", {}, previewHeading(r)), h("p", {}, r.message ?? "")], foot: [button("Back", () => void start(), "btn primary"), captureBoundary()] });
  }
  const readable = r.counts.new + r.counts.inFeed + r.counts.hidden;
  show({
    connected: true,
    body: [
      h("h1", {}, previewHeading(r)),
      h("p", { class: "meta" }, `Read from the ${r.site} page you have open. Nothing else was opened.`),
      h("p", { class: "summary" }, resultSummary(r, "preview")),
      listOf(r),
      r.counts.hidden > 0 && h("p", { class: "meta" }, "Hidden jobs are saved to the hidden pile with their reason, so a wrong dealbreaker can be undone."),
      r.kind === "search" && h("p", { class: "meta" }, "Want more? Scroll or open the next page yourself, then capture again."),
    ],
    foot: [
      h("div", { class: "actions" },
        readable > 0 && button(actionLabel(r), () => void add(page), "btn primary"),
        button("Cancel", () => void start(), "btn ghost"),
      ),
      captureBoundary(),
    ],
  });
}

async function add(page: CapturedPage) {
  show({ connected: true, body: [h("p", { class: "meta", role: "status" }, "Adding to your Feed…")], foot: [captureBoundary()] });
  const answer = await client.capture(page);
  if (!answer.ok) return problem(answer);
  const r = answer.report;
  const c = connection!;
  show({
    connected: true,
    body: [
      h("div", { class: "banner success", role: "status" }, h("div", { class: "text" }, resultSummary(r, "done") || "Nothing to add")),
      listOf(r),
      h("p", { class: "meta" }, `Source: ${r.source ?? r.site}. Each job is re-checked on the company's own job system where apply-kit has one; otherwise it shows "unverified" after 30 days and stays in the Feed.`),
      r.kind === "search" && h("p", { class: "meta" }, "Want more? Scroll or open the next page yourself, then capture again."),
    ],
    foot: [
      h("div", { class: "actions" },
        h("a", { class: "btn primary", href: c.serviceUrl, target: "_blank", rel: "noopener" }, "Open the Feed"),
        button("Done", () => void start(), "btn ghost"),
      ),
    ],
  });
}

// ---------- following Kris's tab (words only) and the keyboard command ----------

const windowId = (await browser.windows.getCurrent()).id;
/** The tab Kris looks at changed (another tab, or a new address or title): say what's there now. */
function tabChanged() {
  if (connection?.state === "ready" && !busy) void ready();
}
browser.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) tabChanged(); });
browser.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.active && tab.windowId === windowId && (change.url || change.title)) tabChanged(); });
browser.commands.onCommand.addListener((command) => {
  if (command !== "fill-this-page" || connection?.state !== "ready") return;
  chosen = "fill";
  void ready().then(() => { if (fillShown === "portal") fillThisPage(); });
});

void start();
