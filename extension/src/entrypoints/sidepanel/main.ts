// apply-kit's side panel (ADR 0005): one panel, two views, Fill this application and Capture, switched
// in place. It's opened from the toolbar icon or the "Fill this page" command, which is also what lets
// it read the tab Kris is on (activeTab, for that site until the tab moves to another one), unless Kris
// allowed the six portals. Capture reads the page
// once on a click, asks apply-kit what it would add, and only "Add" stores anything (in apply-kit,
// never here). Fill recognises the portal and the job from the tab's address, asks apply-kit which
// approved package fits, and only on "Fill this page" injects the filler into the tab, reads the page,
// gets the answers from apply-kit and fills them (Greenhouse, Lever and Ashby so far; a portal's form
// embedded in a company page is filled in its frame when Kris allowed the portals, or offered to open
// on its own). The browser keeps only which
// fill session each tab is in. The panel follows the tab Kris looks at only to update what it says;
// it never reads or touches a page by itself.
import { browser } from "wxt/browser";
import type { CaptureReport, CapturedPage, FieldAnswer, FieldOutcome, FillPage, FillStart, MarkResult, PackageFileKind, PackageInBrief, PageReading } from "@apply-kit/core";
import { countOutcomes } from "@apply-kit/core/fill";
import "../../../../app/ui/src/styles/tokens.css";
import "../../../../app/ui/src/styles/components.css";
import "./panel.css";
import { contextCard, fillStateFor, openingView, type PanelView, type PortalsAccess } from "../../context.ts";
import { differentJobLine, fieldRows, fileReport, fillAnnouncement, focusAfterFill, markedBanner, markedLines, matchWhy, packageLines, submitPrompt, type FieldRow } from "../../fill-report.ts";
import { filledPortals } from "../../fill/fillers.ts";
import type { FileToAttach } from "../../fill/greenhouse.ts";
import { frameAddress, frameSources, runFiller } from "../../fill/in-page.ts";
import { grabPage } from "../../grab.ts";
import { embeddedForm, portalOrigins, portals, recognisePortal, type EmbeddedForm } from "../../portal.ts";
import { actionLabel, captureButtonLabel, itemStatus, previewHeading, resultSummary } from "../../report.ts";
import { createClient, defaultServiceUrl, type Answer, type Connection } from "../../service.ts";
import { createTabSessions } from "../../sessions.ts";

const client = createClient({ fetch: (input, init) => fetch(input, init), store: browser.storage.local });
/** Tab → fill session id: the only fill state kept in the browser (session storage, gone when Chrome closes). */
const sessions = createTabSessions(browser.storage.session);
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
function svg(markup: string, cls = ""): HTMLElement {
  const span = h("span", { class: `ico ${cls}`.trim(), "aria-hidden": "true" });
  span.innerHTML = markup;
  return span;
}
const icons = {
  brand: '<svg viewBox="0 0 24 24"><path d="M2 20 9 7l4 7 3-4 6 10z" fill="var(--action)"/><circle cx="17.5" cy="5.5" r="2" fill="var(--bloom)"/></svg>',
  check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.6v3M6 8.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  dot: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.4" fill="currentColor"/></svg>',
  ask: '<svg viewBox="0 0 12 12"><path d="M4.3 4.4a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="9.8" r=".9" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  partly: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 18 18"><path d="M4 2h7l4 4v10H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 2v4h4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  dash: '<svg viewBox="0 0 12 12"><path d="M3 6h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
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
  // Undo after marking stays in the panel until it closes: a reminder on every other Fill view.
  const reminder = connected && lastMarked && !onMarkedScreen && fillTab.getAttribute("aria-pressed") === "true" ? markedReminder(lastMarked) : null;
  onMarkedScreen = false;
  body.replaceChildren(...[reminder, ...b].filter((c): c is Node | string => !!c));
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
  if (state === "not-portal") {
    // A form apply-kit doesn't know has no confirmation page to detect: "I've submitted this" sits in
    // the footer, for the package this tab is filling.
    const tabSession = tab?.id != null ? await sessions.get(tab.id) : null;
    const offer = tabSession && submitPrompt({ known: false, pageKind: null }) === "footer";
    return show({
      connected: true,
      body: [ctxCard(card.where, card.job, card.why, false), h("p", {}, "Filling works on Workday, Greenhouse, Lever, SmartRecruiters, Workable and Ashby. On other forms it fills nothing unless you ask.")],
      foot: [
        button("Capture this job", () => choose("capture"), "btn primary"),
        button("Fill a form embedded here", () => void fillThisPage(), "btn", { "aria-describedby": "embed-note" }),
        offer && button("I've submitted this", () => void markSubmitted(tab!.id!, tabSession, address ?? null), "btn"),
        h("p", { id: "embed-note", class: "bound" }, "Looks for a Greenhouse, Lever or Ashby form inside this page, only when you click. Never presses Next or Submit."),
      ],
    });
  }

  // Which package fits, without opening anything: the page isn't touched until Fill this page.
  const sessionId = tab?.id != null ? await sessions.get(tab.id) : null;
  const matched = page.ref || sessionId ? await client.fill.match(fillPageOf(address!, page)!, sessionId) : null;
  if (matched && !matched.ok && matched.state !== "error") return problem(matched);
  const m = matched?.ok ? matched.value : null;
  // A different job shows as what Fill would match now; the click ends the old session and says so.
  showMatch({ tab: tab!, page, card, match: m?.kind === "different-job" ? m.then : m, keys, access });
}

const fillPrimary = () => button("Fill this page", () => void fillThisPage(), "btn primary", { id: "fill-btn" });

function ctxCard(where: string, job: string, why: string, sure: boolean) {
  return h("div", { class: "ctx" },
    h("span", { class: "where" }, where),
    h("h1", { class: "job" }, job),
    h("span", { class: "why" }, sure ? svg(icons.check) : svg(icons.info, "info"), h("span", {}, why)),
  );
}

/** The page as the fill engine sees it: portal, host and job reference from the address. */
function fillPageOf(address: string, page: ReturnType<typeof recognisePortal>): FillPage | null {
  if (page.portal === "unknown") return null;
  return { portal: page.portal, host: new URL(address).hostname, jobRef: page.ref };
}

function packageList(p: Extract<FillStart, { kind: "matched" }>["package"]) {
  return h("dl", { class: "pkg" }, ...packageLines(p).flatMap((l) => [h("dt", {}, l.term), h("dd", {}, l.detail, l.note && h("span", { class: "meta" }, l.note))]));
}

/** The Fill view for a portal page and what apply-kit matched it to. */
function showMatch({ tab, page, card, match, keys, access, banner }: {
  tab: Awaited<ReturnType<typeof currentTab>> & object; page: ReturnType<typeof recognisePortal>; card: ReturnType<typeof contextCard>;
  match: FillStart | null; keys: string; access: PortalsAccess; banner?: Node;
}) {
  const label = portals.find((p) => p.name === page.portal)!.label;
  const loop = h("div", { class: "callout" },
    h("b", {}, `Each page: click Fill, check, then continue on ${label}`),
    h("span", {}, `apply-kit fills the page you're looking at and marks every field it touched. It never presses ${label}'s buttons. When the next page shows, click Fill this page again.`),
    keys && h("span", { class: "meta" }, `Shortcut: ${keys}. Change it at chrome://extensions/shortcuts.`),
  );
  const notNowNote = access === "not-now" && h("div", { class: "callout" },
    h("b", {}, "Without the portals permission"),
    h("span", {}, `Click the apply-kit icon in the toolbar on each new page before filling${keys ? `, or press ${keys}` : ""}. Forms embedded in company sites can't be filled.`),
    button("Allow the 6 portals", () => requestPortals(), "btn sm"),
  );

  if (match?.kind === "matched") {
    return show({
      connected: true,
      body: [banner, ctxCard(`${label} · ${match.package.job.company}`, match.package.job.title, matchWhy(match, page.ref), true), packageList(match.package), loop, notNowNote],
      foot: [fillPrimary(), fillBoundary()],
    });
  }
  if (match?.kind === "choose") {
    const name = "pick-package";
    const options = match.candidates.map((c, i) => h("label", { class: "opt" },
      h("input", { type: "radio", name, value: c.id, ...(i === 0 ? { checked: "" } : {}) }),
      h("span", {}, `${c.job.title} · ${c.job.company}`, h("span", { class: "meta block" }, `${c.cv.fileName} · approved ${new Date(c.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`)),
    ));
    const picked = () => (body.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? match.candidates[0]!.id);
    return show({
      connected: true,
      body: [banner, ctxCard(card.where, card.job, `No approved package targets job ${page.ref?.jobId ?? "on this page"}, but ${match.candidates.length === 1 ? "one" : match.candidates.length} on this board could be it.`, false),
        h("fieldset", { class: "pick" }, h("legend", {}, "Which application is this?"), ...options),
        h("p", { class: "meta" }, "apply-kit never guesses between packages. Pick the one this form is for, or none.")],
      foot: [button("Fill with this package", () => void fillThisPage(picked()), "btn primary"), button("None of these", () => showMatch({ tab, page, card, match: { kind: "no-package", job: null }, keys, access }), "btn ghost"), fillBoundary()],
    });
  }
  if (match?.kind === "no-package") {
    const c = connection!;
    const draft = match.job;
    return show({
      connected: true,
      body: [
        banner,
        ctxCard(card.where, card.job, draft ? draft.reason : "There's no approved package for this job, so there's nothing to fill from.", false),
        h("p", {}, draft
          ? "Your package for this job is still a draft. Approve it in apply-kit, then come back to this tab and click Fill this page."
          : "A package gives this form a tailored CV, a cover letter and your approved answers. Capture the job, prepare the package in apply-kit (about 5 minutes), then come back to this tab."),
      ],
      foot: draft
        ? [h("a", { class: "btn primary", href: `${c.serviceUrl}/jobs/${encodeURIComponent(draft.id)}/package`, target: "_blank", rel: "noopener" }, "Open the package"), fillBoundary()]
        : [
            button("Capture and prepare", () => void captureAndPrepare(), "btn primary"),
            button("Capture only", () => choose("capture"), "btn"),
            h("p", { class: "bound" }, "\"Capture and prepare\" adds the job to your Feed and gives you its package in apply-kit. This tab stays as it is."),
          ],
    });
  }
  // No answer about packages (the app answered with an error, or no job on this page yet): the address card only.
  show({
    connected: true,
    body: [banner, ctxCard(card.where, card.job, card.why, !!page.ref), loop, notNowNote],
    foot: [fillPrimary(), fillBoundary()],
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

// ---------- Filling a page ----------

/** Set by Stop filling; checked between the steps of a fill. */
let stopRequested = false;
/** "Press F6 to move to the page" is said once, the first time Show on page is used. */
let toldF6 = false;

/** Tab → the frame of the portal form embedded in its page, while the panel fills it (kept in memory only). */
const embedFrames = new Map<number, number>();

/** Injects the filler into the tab, or its embedded form's frame (on this click only), and runs one of its commands there. */
async function inPage<T>(tabId: number, command: Parameters<typeof runFiller>[0], args: unknown[] = []): Promise<T | null> {
  const frame = embedFrames.get(tabId);
  const target = frame === undefined ? { tabId } : { tabId, frameIds: [frame] };
  try {
    await browser.scripting.executeScript({ target, files: ["/filler.js"] });
    const [res] = await browser.scripting.executeScript({ target, func: runFiller, args: [command, args] });
    return (res?.result as T | undefined) ?? null;
  } catch {
    return null;
  }
}

function fillProblem(answer: Exclude<Answer<unknown>, { ok: true }>, during?: string) {
  if (answer.state === "error") {
    return show({ connected: true, body: [h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, answer.error))], foot: [button("Back", () => void start(), "btn primary"), fillBoundary()] });
  }
  return answer.state === "not-running" ? notRunning(connection!, during) : unpaired(connection!, "apply-kit no longer knows this extension. Pair it again.");
}

/** The portal form embedded in the tab's page (read from the page's frames, on Kris's click), or null. */
async function findEmbed(tabId: number): Promise<EmbeddedForm | null> {
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: frameSources });
    return embeddedForm((res?.result as string[] | undefined) ?? []);
  } catch {
    return null;
  }
}

/** The frame Chrome lets apply-kit into that shows the embedded form (needs the portals permission). */
async function embedFrame(tabId: number, embed: EmbeddedForm): Promise<number | null> {
  try {
    const results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: frameAddress });
    const hit = results.find((r) => r.frameId !== 0 && recognisePortal(r.result as string).ref?.jobId === embed.ref.jobId);
    return hit ? hit.frameId : null;
  } catch {
    return null;
  }
}

/** A portal's form inside a company page that apply-kit can't reach: open it on its own (a link, opened only by Kris's click). */
function embedOffer(embed: EmbeddedForm, card: ReturnType<typeof contextCard>, access: PortalsAccess) {
  const label = portals.find((p) => p.name === embed.portal)!.label;
  busy = false;
  show({
    connected: true,
    body: [
      ctxCard(`${label} form inside ${card.where.replace(/^Not a portal apply-kit knows · /, "")}`, card.job, `Job ${embed.ref.jobId}, from the form's address. Nothing on the page has been read or filled.`, true),
      h("p", {}, access === "granted"
        ? `Chrome didn't let apply-kit into the ${label} form on this page. Open the form on its own and fill it there: it's the same application.`
        : `This ${label} form sits inside the company's page, where apply-kit can fill it only with the portals permission. Open the form on its own and fill it there: it's the same application.`),
    ],
    foot: [
      h("a", { class: "btn primary", href: embed.src, target: "_blank", rel: "noopener" }, "Open the form on its own"),
      access !== "granted" && button("Allow the 6 portals", () => requestPortals(), "btn"),
      h("p", { class: "bound" }, "The form opens in a new tab only when you click. apply-kit never presses Next or Submit."),
    ],
  });
  announce(`This ${label} form is inside the company's page. Open the form on its own to fill it.`);
}

/** Fill this page: re-read the job, match it, then read, answer and fill the page. Nothing is pressed. */
async function fillThisPage(packageId?: string) {
  const tab = await currentTab();
  if (tab?.id == null || !tab.url) return;
  const tabId = tab.id;
  let page = recognisePortal(tab.url);
  let address = tab.url;
  const access = await portalsAccess();
  embedFrames.delete(tabId);
  // A company page: the form may be a portal's, in a frame (Greenhouse's ?gh_jid=, Ashby's ?ashby_jid=, or none).
  if (page.portal === "unknown" || page.ref?.board === null) {
    const embed = await findEmbed(tabId);
    if (embed) {
      const card = contextCard(page, { address: tab.url, title: tab.title });
      const frame = access === "granted" ? await embedFrame(tabId, embed) : null;
      if (frame === null) return embedOffer(embed, card, access);
      embedFrames.set(tabId, frame);
      page = recognisePortal(embed.src);
      address = embed.src;
    } else if (page.portal === "unknown") {
      return announce("No Greenhouse, Lever or Ashby form on this page. Nothing was read or filled.");
    }
  }
  const fp = fillPageOf(address, page);
  if (!fp) return;
  busy = true;
  stopRequested = false;
  const keys = await shortcut();
  const card = contextCard(page, { address, title: tab.title });

  const started = await client.fill.start(fp, { sessionId: await sessions.get(tabId), packageId });
  if (!started.ok) return fillProblem(started, "Nothing was filled: apply-kit stopped answering. This page hasn't been touched.");
  let s = started.value;
  let banner: Node | undefined;
  if (s.kind === "different-job") {
    banner = h("div", { class: "banner warning", role: "alert" }, h("div", { class: "text" }, h("b", {}, "This is a different job. "),
      differentJobLine(s.previous, { title: s.then.kind === "matched" ? s.then.package.job.title : card.job, jobId: page.ref?.jobId ?? null })));
    s = s.then;
    if (s.kind === "matched" && s.session) await sessions.set(tabId, s.session.id);
    else await sessions.clear(tabId);
    busy = false;
    return showMatch({ tab, page, card, match: s, keys, access, banner });
  }
  if (s.kind !== "matched" || !s.session) {
    busy = false;
    return showMatch({ tab, page, card, match: s, keys, access });
  }
  const session = s.session;
  await sessions.set(tabId, session.id);
  const ctx = ctxCard(`${portals.find((p) => p.name === page.portal)!.label} · ${s.package.job.company}`, s.package.job.title, matchWhy(s, page.ref), true);

  if (page.portal === "unknown" || !filledPortals.includes(page.portal)) {
    busy = false;
    showMatch({ tab, page, card, match: s, keys, access });
    body.append(h("p", { class: "meta", role: "status" }, "apply-kit fills Greenhouse, Lever and Ashby pages so far; this portal comes in a later update. This page hasn't been touched."));
    return;
  }

  show({
    connected: true,
    body: [ctx, h("div", { class: "pagehead" }, h("h2", {}, h("span", { class: "row" }, h("span", { class: "spin", "aria-hidden": "true" }), "Filling this page")), h("p", { class: "meta" }, "Reading the page's fields…"))],
    foot: [button("Stop filling", () => { stopRequested = true; }, "btn"), h("p", { class: "bound" }, "Stop keeps what's filled so far; Undo this page appears when it stops.")],
  });
  announce("Filling this page…");

  const stopped = (what: string) => {
    busy = false;
    showMatch({ tab, page, card, match: s, keys, access });
    announce(what);
  };
  const reading = await inPage<PageReading>(tabId, "read");
  if (!reading) return stopped("Chrome didn't let apply-kit read this page. Click the apply-kit icon in the toolbar on it, then Fill this page.");
  if (stopRequested) return stopped("Stopped. Nothing was filled.");
  if (submitPrompt({ known: true, pageKind: reading.pageKind }) === "ask") {
    busy = false;
    return didYouSubmit({ tabId, ctx, sessionId: session.id, portalUrl: address, portal: portals.find((p) => p.name === page.portal)!.label });
  }
  const answers = await client.fill.answer(session.id, reading);
  if (!answers.ok) return fillProblem(answers, "Nothing was filled: apply-kit stopped answering. This page hasn't been touched.");
  if (stopRequested) return stopped("Stopped. Nothing was filled.");
  // The package's files for this page's file fields only, held here just long enough to attach them.
  // One the app can't give is reported as not attached, with the file one click away.
  const files: FileToAttach[] = [];
  const paths = new Map<PackageFileKind, string | null>();
  for (const a of answers.value) {
    if (a.kind !== "file") continue;
    const file = await client.fill.file(session.id, a.which);
    if (!file.ok) continue;
    files.push({ which: file.value.which, fileName: file.value.fileName, type: file.value.type, base64: file.value.base64 });
    paths.set(a.which, file.value.path);
  }
  if (stopRequested) return stopped("Stopped. Nothing was filled.");
  const outcomes = await inPage<FieldOutcome[]>(tabId, "fill", [answers.value, files]);
  files.length = 0;
  if (!outcomes) return stopped("Chrome didn't let apply-kit fill this page. Nothing was filled.");
  const recorded = await client.fill.record(session.id, reading, outcomes);
  filled({ tabId, ctx, reading, answers: answers.value, outcomes, at: recorded.ok ? recorded.value.filledAt : new Date().toISOString(), portal: portals.find((p) => p.name === page.portal)!.label, pkg: s.package, sessionId: session.id, paths });
}

const chipIcon = { met: icons.check, ask: icons.ask, partly: icons.partly, gap: icons.x, closed: icons.dash } as const;

/** The Filled state: counts, what needs Kris first, then every field in the portal's order, Undo this page. */
function filled(f: {
  tabId: number; ctx: HTMLElement; reading: PageReading; answers: FieldAnswer[]; outcomes: FieldOutcome[]; at: string; portal: string;
  pkg: PackageInBrief; sessionId: string; paths: Map<PackageFileKind, string | null>;
}, announceIt = true) {
  const rows = fieldRows(f.reading, f.answers, f.outcomes);
  const counts = countOutcomes(f.outcomes);
  const files = fileReport(f.pkg, f.answers, f.outcomes, f.portal);
  const fileChip = (line: Node | string, meta: string | null) => h("div", { class: "filechip" }, svg(icons.file), h("span", {}, line, meta && h("span", { class: "meta block" }, meta)));
  const attachedChips = files.attached.map((a) => fileChip(h("span", {}, h("b", {}, a.label), ` ${a.line}`), a.meta));
  // A file the portal didn't take: what happened, then the file one click away (Finder, or its path).
  const failedBlocks = files.failed.flatMap((x) => {
    const path = f.paths.get(x.which) ?? null;
    const reveal = async () => {
      const r = await client.fill.reveal(f.sessionId, x.which);
      announce(r.ok ? `Showing ${x.fileName} in Finder.` : r.state === "error" ? r.error : "apply-kit isn't answering, so Finder can't show the file.");
    };
    const copy = async () => {
      const ok = path ? await navigator.clipboard.writeText(path).then(() => true, () => false) : false;
      announce(ok ? "File path copied." : "Couldn't copy the file path.");
    };
    return [
      h("div", { class: "banner warning", role: "alert" }, h("div", { class: "text" }, h("b", {}, x.heading), ` ${x.text}`)),
      fileChip(`${x.fileName} · ${x.size}`, path ? "In your Packages folder" : "Not in your Packages folder: open the package in apply-kit to download it."),
      h("div", { class: "row" },
        button("Show in Finder", () => void reveal(), "btn sm", { "aria-label": `Show ${x.fileName} in Finder` }),
        path ? button("Copy file path", () => void copy(), "btn ghost sm") : ""),
      h("p", { class: "meta" }, `Then drag it onto the ${x.which === "cv" ? "CV" : "cover letter"} box, or click Attach there and pick it. Click Fill this page again afterwards: ${f.portal} may change fields while reading it.`),
    ];
  });
  const showOnPage = async (row: FieldRow) => {
    const ok = await inPage<boolean>(f.tabId, "show", [row.fieldId]);
    announce(ok ? `Showing ${row.label} on the page.${toldF6 ? "" : " Press F6 to move to the page."}` : `${row.label} isn't on this page any more.`);
    toldF6 = true;
  };
  const chip = (tone: string, icon: string, text: string) => h("span", { class: `chip ${tone}` }, svg(icon), text);
  const needs = rows.filter((r) => r.outcome === "needs-you").map((r) => h("div", { class: "need", id: `need-${r.fieldId}`, tabindex: "-1" }, h("div", {},
    h("p", { class: "q" }, r.label, r.limit && h("span", { class: "meta" }, ` (${r.limit})`)),
    r.why && h("p", { class: "basis" }, r.why),
    r.value !== "Not filled" && h("p", { class: "suggest" }, r.value),
    h("div", { class: "row" }, button("Show on page", () => void showOnPage(r), "btn ghost sm", { "aria-label": `Show ${r.label} on page` })),
  )));
  const list = h("ul", { class: "flist" }, ...rows.map((r) => h("li", {},
    button("", () => void showOnPage(r), "frow"),
    r.offer && r.outcome === "kept" && button(`Replace with ${r.offer}`, () => void replace(r), "btn ghost sm replace"),
  )));
  // Each row reads label → value → source (AX-01); the chip sits on the right by the grid.
  list.querySelectorAll<HTMLButtonElement>(".frow").forEach((b, i) => {
    const r = rows[i]!;
    b.replaceChildren(h("span", { class: "l" }, r.label), h("span", { class: "v" }, r.value), chip(r.chip.tone, chipIcon[r.chip.tone], r.chip.word), ...[r.why && r.outcome !== "needs-you" ? h("span", { class: "why2" }, r.why) : ""], h("span", { class: "sr-only" }, ". Show on page"));
  });
  const replace = async (r: FieldRow) => {
    const outcome = await inPage<FieldOutcome["outcome"]>(f.tabId, "replace", [r.fieldId, r.offer]);
    const source = f.answers.find((a) => a.fieldId === r.fieldId);
    const outcomes = f.outcomes.map((o) => (o.fieldId === r.fieldId && outcome ? { ...o, outcome, source: outcome === "filled" && source?.kind === "fill" ? source.source : null } : o));
    announce(outcome === "filled" ? `Replaced ${r.label}.` : `${r.label} didn't take the new value.`);
    filled({ ...f, outcomes }, false);
  };
  const time = new Date(f.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  show({
    connected: true,
    body: [
      f.ctx,
      h("div", { class: "pagehead" },
        h("h2", {}, f.reading.stepLabel ?? "This page"),
        h("div", { class: "counts" },
          chip("met", icons.check, `${counts.filled} filled`),
          counts.needsYou > 0 && chip("ask", icons.ask, `${counts.needsYou} ${counts.needsYou === 1 ? "needs" : "need"} you`),
          counts.kept > 0 && chip("partly", icons.partly, `${counts.kept} kept`),
          ...files.failed.map((x) => chip("gap", icons.x, x.chip)),
          counts.didntStick - files.failed.length > 0 && chip("gap", icons.x, `${counts.didntStick - files.failed.length} didn't stick`),
        ),
        h("p", { class: "meta" }, f.reading.stepCount ? `Page ${f.reading.stepCount.current} of ${f.reading.stepCount.total}, as ${f.portal} shows it. Filled ${time}.` : `Filled ${time}.`),
      ),
      ...failedBlocks,
      ...attachedChips,
      files.letter && h("p", { class: "meta" }, files.letter),
      ...needs,
      list,
      h("p", { class: "meta" }, "On the page: a tick marks each field apply-kit filled, a \"?\" each field that needs you, a half circle each value it kept. Select a row to see its field."),
      button("Undo this page", () => void undoPage(f.tabId), "btn ghost sm undo"),
      h("div", { class: "callout" },
        h("b", {}, `Next: check the page, then press ${f.portal}'s own button yourself.`),
        h("span", {}, "apply-kit never presses Next or Submit. The package stays with this tab until you mark it submitted or close the tab."),
      ),
    ],
    foot: [fillPrimary(), fillBoundary()],
  });
  // The list stays until the tab's address or title changes; then the panel shows the page as it is now.
  busy = false;
  if (!announceIt) return;
  announce(fillAnnouncement(counts));
  const first = focusAfterFill(f.outcomes);
  (first ? document.getElementById(`need-${first}`) : document.getElementById("fill-btn"))?.focus();
}

async function undoPage(tabId: number) {
  const restored = await inPage<number>(tabId, "undo");
  announce(restored === null ? "Chrome didn't let apply-kit undo on this page." : `Undone: ${restored === 1 ? "1 field is" : `${restored} fields are`} back to how ${restored === 1 ? "it was" : "they were"}, and the marks are gone.`);
  busy = false;
  void ready();
}

// ---------- Did you submit? and Mark as submitted ----------

/** The last mark in this panel, so Undo stays until the panel closes. */
let lastMarked: Extract<MarkResult, { marked: true }> | null = null;
/** Set while the Marked state itself shows (it has its own Undo). */
let onMarkedScreen = false;

const applicationLink = (id: string, label = "Open the Application", cls = "btn primary") =>
  h("a", { class: cls, href: `${connection!.serviceUrl}/applications/${encodeURIComponent(id)}`, target: "_blank", rel: "noopener" }, label);

/** The portal's confirmation page: a hint, not proof. Nothing is created until Kris clicks Mark as submitted. */
function didYouSubmit(d: { tabId: number; ctx: HTMLElement; sessionId: string; portalUrl: string | null; portal: string }) {
  show({
    connected: true,
    body: [
      d.ctx,
      h("div", { class: "lead-h" }, h("h2", {}, "Did you submit?"), h("p", { class: "muted" }, `${d.portal} is showing its confirmation page, which usually means yes.`)),
      h("p", { class: "meta" }, "Marking creates the Application with this package linked, so apply-kit can match the company's emails to it."),
    ],
    foot: [
      button("Mark as submitted", () => void markSubmitted(d.tabId, d.sessionId, d.portalUrl), "btn primary", { id: "mark-btn" }),
      button("Not yet", () => { announce("Not marked. Click Fill this page on the confirmation page when you're ready."); void ready(); }, "btn ghost"),
    ],
  });
  announce("Did you submit? The portal is showing its confirmation page.");
  document.getElementById("mark-btn")?.focus();
}

async function markSubmitted(tabId: number, sessionId: string, portalUrl: string | null) {
  busy = true;
  const r = await client.fill.markSubmitted(sessionId, portalUrl);
  if (!r.ok) return fillProblem(r, "Nothing was marked: apply-kit stopped answering.");
  const m = r.value;
  if (!m.marked) {
    busy = false;
    return show({
      connected: true,
      body: [h("div", { class: "banner warning", role: "alert" }, h("div", { class: "text" }, h("b", {}, "Nothing was created. "), m.reason))],
      foot: [m.application ? applicationLink(m.application.id) : button("Back", () => void ready(), "btn primary"), m.application && button("Back", () => void ready(), "btn ghost")],
    });
  }
  // The fill session for this tab ends here; the next portal in this tab starts fresh.
  await sessions.clear(tabId);
  if (!m.alreadyMarked) lastMarked = m;
  showMarked(m);
}

/** "Marked as submitted": the Application created (or the one already there), with Undo until the panel closes. */
function showMarked(m: Extract<MarkResult, { marked: true }>) {
  const banner = markedBanner(m);
  onMarkedScreen = true;
  show({
    connected: true,
    body: [
      h("div", { class: "banner success", role: "status" }, h("div", { class: "text" }, h("b", {}, banner.lead), ` ${banner.rest}`)),
      h("dl", { class: "pkg" }, ...markedLines(m.application, m.package).flatMap((l) => [
        h("dt", {}, l.term),
        h("dd", {}, l.term === "Status" ? h("span", { class: `status ${m.application.status}` }, h("i", {}), l.detail) : l.detail),
      ])),
      h("p", { class: "meta" }, "Track takes it from here: replies to the job address move its status, and a follow-up comes due if nothing arrives."),
    ],
    foot: [applicationLink(m.application.id), !m.alreadyMarked && button("Undo", () => void undoMarked(m), "btn ghost", { "aria-label": "Undo mark as submitted" })],
  });
  busy = false;
  announce(`${banner.lead} ${banner.rest}`);
  // The button pressed is gone: focus moves to the state's primary action.
  foot.querySelector<HTMLElement>(".btn.primary")?.focus();
}

/** The reminder on the Fill view after marking: Undo stays until the panel closes. */
function markedReminder(m: Extract<MarkResult, { marked: true }>) {
  return h("div", { class: "banner success" }, h("div", { class: "text" }, h("b", {}, "Marked as submitted. "), `${m.application.title} at ${m.application.company}.`),
    button("Undo", () => void undoMarked(m), "btn ghost sm", { "aria-label": "Undo mark as submitted" }));
}

async function undoMarked(m: Extract<MarkResult, { marked: true }>) {
  const r = await client.fill.undoMarkSubmitted(m.application.id);
  if (!r.ok && r.state !== "error") return fillProblem(r, "Nothing was undone: apply-kit stopped answering.");
  lastMarked = null;
  if (!r.ok) {
    return show({
      connected: true,
      body: [h("div", { class: "banner error", role: "alert" }, h("div", { class: "text" }, r.error))],
      foot: [applicationLink(m.application.id), button("Back", () => void ready(), "btn ghost")],
    });
  }
  announce("Undone: the Application is removed and the package is waiting to be submitted again.");
  busy = false;
  void ready();
}

/** "Capture and prepare": captures the job into the Feed and offers its package in apply-kit. This tab stays as it is. */
async function captureAndPrepare() {
  busy = true;
  show({ connected: true, body: [h("p", { class: "meta", role: "status" }, "Adding this job to your Feed…")], foot: [fillBoundary()] });
  const page = await readTab();
  if (!page) return capture();
  const answer = await client.capture(page);
  if (!answer.ok) return problem(answer);
  const jobId = answer.report.listings.find((l) => l.jobId)?.jobId;
  const c = connection!;
  show({
    connected: true,
    body: [
      h("div", { class: "banner success", role: "status" }, h("div", { class: "text" }, resultSummary(answer.report, "done") || "The job is in your Feed")),
      h("p", {}, "Prepare and approve its package in apply-kit, then come back to this tab and click Fill this page."),
    ],
    foot: [
      h("div", { class: "actions" },
        jobId ? h("a", { class: "btn primary", href: `${c.serviceUrl}/jobs/${encodeURIComponent(jobId)}/package`, target: "_blank", rel: "noopener" }, "Prepare the package")
          : h("a", { class: "btn primary", href: c.serviceUrl, target: "_blank", rel: "noopener" }, "Open the Feed"),
        button("Back", () => void start(), "btn ghost"),
      ),
      fillBoundary(),
    ],
  });
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
// A click on the toolbar icon grants activeTab on the tab (ADR 0005): look at it again.
browser.action.onClicked.addListener((tab) => { if (tab.windowId === windowId) tabChanged(); });
browser.commands.onCommand.addListener((command) => {
  if (command !== "fill-this-page" || connection?.state !== "ready") return;
  chosen = "fill";
  void ready().then(() => { if (fillShown === "portal") void fillThisPage(); });
});

void start();
