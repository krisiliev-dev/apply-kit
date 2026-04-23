import type { CVContent } from "@/lib/types";
import { defaultCV } from "./default";

// Register each CV variant here.
// To create a new one: copy default.ts, edit, import it, add to this map.
export const cvs: Record<string, CVContent> = {
  [defaultCV.slug]: defaultCV,
};

export const cvList = Object.values(cvs);
