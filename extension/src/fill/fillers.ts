import { createWorkdayFiller } from "./workday.ts";
import { createSmartRecruitersFiller } from "./smartrecruiters.ts";
import { createWorkableFiller } from "./workable.ts";
// The filler for a page, by the portal its address (a tab's, or an embedded form's frame's) belongs to.
import { recognisePortal, type PortalName } from "../portal.ts";
import { createAshbyFiller } from "./ashby.ts";
import { createGreenhouseFiller, type Filler } from "./greenhouse.ts";
import { createLeverFiller } from "./lever.ts";

const makers: Partial<Record<PortalName, () => Filler>> = { workday: createWorkdayFiller, greenhouse: createGreenhouseFiller, lever: createLeverFiller, ashby: createAshbyFiller, smartrecruiters: createSmartRecruitersFiller, workable: createWorkableFiller };

/** The portals apply-kit fills so far. */
export const filledPortals = Object.keys(makers) as PortalName[];

export function fillerFor(address: string): Filler | null {
  const portal = recognisePortal(address).portal;
  return portal === "unknown" ? null : makers[portal]?.() ?? null;
}
