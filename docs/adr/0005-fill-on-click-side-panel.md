# Fill on click from a side panel, with one filler per portal tested on saved pages

Filling a portal happens only when Kris clicks: the extension's **side panel** (which replaces the Capture popup and hosts both Capture and Fill) injects the filler into the page with `scripting.executeScript` on each "Fill this page" click or the "Fill this page" keyboard command. There are no declared content scripts, nothing watches the page, and the filler never presses navigation or submit controls. Access to the six supported portal hosts (Workday, Greenhouse, Lever, SmartRecruiters, Workable, Ashby) comes from **optional host permissions** Kris grants once, from a click, on the first fill; every other site relies on `activeTab` from the toolbar icon or the command. The page reading and filling are split from everything personal: the panel asks the local service which value goes in each field, so the in-page code never fetches anything and holds only the answers for the fields on screen and, for Undo, the values they replaced.

Each supported portal has a **filler** behind one interface: `read(document) → page reading` (page kind, portal job reference, step label, fields with label, kind, options, limits and current value) and `fill(document, answers) → outcome per field` (filled, kept, didn't stick, skipped), plus `undo()`. A generic filler implements the same interface with the ported label chain and fills only on an explicit opt-in. All in-page DOM changes (setting values, dispatching input/change events, opening a form widget, adding a repeating entry, attaching a file, scrolling a field into view) go through one **page-actions** module that refuses any control whose role, type or text marks it as navigation or submission. The extension's existing "only acts on a click" guard test allows events and clicks only in that module and checks its refusal list.

Fillers are tested against **saved synthetic portal pages** (HTML fixtures with the persona's made-up data, never real pages with real data) in a DOM (happy-dom), at the filler interface: read the fixture, fill it with fixed answers, assert on the resulting DOM and outcomes. Deciding *what* goes in each field (profile, answer bank, package, needs-you drafts) lives in the core and is tested through its public interface with an in-memory database, a fake clock and a fake drafter.

## Considered options

- **Popup only (as Capture shipped).** Rejected: a popup closes the moment Kris clicks into the portal, which happens on every page of a multi-step application, so needs-you questions and the field list would vanish while being answered.
- **UI injected into the portal page (shadow DOM overlay).** Rejected: our UI would live inside a third-party page (its CSS, its focus traps, its bot detection), it disappears on every full page load, and it can't hold the paired connection.
- **Declared content scripts on the six portal hosts.** Rejected: code would run on every portal page Kris opens, and the user-driven rule ("nothing happens without a click") would rest on discipline instead of on the manifest.
- **`activeTab` only.** Not enough on its own: it's dropped when the tab loads a page on another site (Workday's account redirect, a company page linking to its portal), and it doesn't reach cross-origin embedded forms (a Greenhouse form inside a company site). Kept for unknown sites and for Kris saying "Not now" to the portals (see "Verified: `activeTab` and the side panel" below).
- **Filling from the service with a remote-controlled browser (Playwright).** Rejected: it would drive the user's sessions and meet bot protection, which PRODUCT.md rules out.

## Consequences

- The manifest gains `sidePanel` and `optional_host_permissions` for the six portal hosts; no install-time host permission is added.
- Kris clicks once per portal page. That's the price of "never acts on its own" and is within the 10-minute budget.
- Portal markup changes break fillers silently in the wild; the portal trial and "Report this field" (structure only, no values) feed new fixtures, and a field a filler can't handle falls back to needs-you, never to a guess.

## Verified: `activeTab` and the side panel (ticket #37, 2026-10-13)

Checked in Chrome for Testing 147 with the built extension, a throwaway profile and local pages only (the toolbar click driven through the DevTools protocol's `Extensions.triggerAction`, which grants `activeTab` to an ordinary action click: a control extension with `action.onClicked` + `executeScript` got access the same way):

| How the panel is opened | Panel gets `activeTab` on the tab? |
|---|---|
| `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` | **No.** `tabs.query` shows no URL or title and `executeScript` is refused. A second click on the icon closes the panel |
| `action.onClicked` → `sidePanel.open({ windowId })` (what apply-kit does) | **Yes**: the panel sees the tab's URL and title and can inject |

With the panel opened from `action.onClicked`, the grant then:

- survives same-document navigation (`pushState`, how Workday, Ashby and Workable move between steps) and full page loads on the **same site**;
- is dropped when the tab loads a page on **another site**; clicking the icon again with the panel open keeps the panel open and grants access to the new site;
- is also granted by the "Fill this page" command (Chrome's documented behaviour for `commands`; not driven in this check, since the protocol can't press extension shortcuts).

So: the extension opens its panel from `action.onClicked` (not `openPanelOnActionClick`), and the panel re-reads the tab when the icon is clicked again. `activeTab` covers a portal for as long as the tab stays on that portal's site, which is most of an application; the optional host permission is kept for the cross-site cases (account redirects, a company page that opens its portal, embedded forms) and so that Kris doesn't have to click the icon after each of those.

