// Whether single-key shortcuts in the jobs table are on. A per-browser preference: it lives in
// localStorage, and the Feed works the same (shortcuts on) if storage is unavailable.
import { useState } from "react";

const KEY = "apply-kit:feed-shortcuts";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function useShortcutsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  const set = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // Private window or blocked storage: the choice lasts until the page reloads.
    }
  };
  return [on, set];
}
