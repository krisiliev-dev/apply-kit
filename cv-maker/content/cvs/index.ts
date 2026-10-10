import type { CVContent } from "@/lib/types";
import { defaultCV } from "./default";
import { designerCV } from "./designer";
import { engineerCV } from "./engineer";
import { writerCV } from "./writer";

// Register each CV variant here.
// To create a new one: copy default.ts, edit, import it, add to this map.
export const cvs: Record<string, CVContent> = {
  [defaultCV.slug]: defaultCV,
  [designerCV.slug]: designerCV,
  [engineerCV.slug]: engineerCV,
  [writerCV.slug]: writerCV,
};

export const cvList = Object.values(cvs);
