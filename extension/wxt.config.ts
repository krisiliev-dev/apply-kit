import { defineConfig } from "wxt";

// Chrome MV3 (ADR 0002). Capture is click-only: no content scripts and no host permission on any
// job site. "activeTab" lets the popup read the tab Kris is on, only after Kris opens the popup there;
// "scripting" runs the one page reader (src/grab.ts) in it. The only hosts it talks to are this
// laptop's apply-kit service. "storage" keeps the service address and pairing token, nothing else.
export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "apply-kit",
    description: "Capture the job page, or the search results, you're viewing into your apply-kit Feed.",
    permissions: ["activeTab", "scripting", "storage"],
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    action: { default_title: "Capture with apply-kit" },
  },
});
