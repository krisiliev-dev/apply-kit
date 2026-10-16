// The fillers, injected into the portal tab (or the portal's frame in a company page) only when Kris
// clicks Fill (scripting.executeScript with this file; never declared as a content script). Loading
// it does nothing on the page: it only makes the filler for this page's portal available in
// apply-kit's isolated world, where it keeps the previous values for Undo across clicks. The panel
// then calls it with `runFiller` (src/fill/in-page.ts).
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { fillerFor } from "../fill/fillers.ts";
import type { Filler } from "../fill/greenhouse.ts";

export default defineUnlistedScript(() => {
  const world = globalThis as { applyKitFiller?: Filler | null };
  world.applyKitFiller ??= fillerFor(location.href);
});
