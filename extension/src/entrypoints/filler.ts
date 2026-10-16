// The fillers, injected into the portal tab only when Kris clicks Fill (scripting.executeScript with
// this file; never declared as a content script). Loading it does nothing on the page: it only makes
// the portal's filler available in apply-kit's isolated world, where it keeps the previous values for
// Undo across clicks (Workday moves between its steps in the same page). The panel then calls it with
// `runFiller` (src/fill/in-page.ts). The Workday filler gets no press: the extension has no click of
// its own, so Workday's lists, typeaheads, Add and Delete are left to Kris (see #44).
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { recognisePortal } from "../portal.ts";
import { createGreenhouseFiller, type Filler } from "../fill/greenhouse.ts";
import { createWorkdayFiller } from "../fill/workday.ts";

export default defineUnlistedScript(() => {
  const world = globalThis as { applyKitFiller?: Filler };
  world.applyKitFiller ??= recognisePortal(location.href).portal === "workday" ? createWorkdayFiller() : createGreenhouseFiller();
});
