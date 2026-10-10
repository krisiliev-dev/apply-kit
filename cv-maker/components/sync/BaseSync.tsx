"use client";

import { useEffect } from "react";
import { pullBaseFromServer } from "@/lib/profile/base";

// Pulls the base CV/profile from the shared server store into localStorage on
// app load, if the store has a newer copy than this browser (e.g. the agent
// set it via the MCP `write_base` tool). Renders nothing.
export function BaseSync() {
  useEffect(() => {
    void pullBaseFromServer();
  }, []);
  return null;
}
