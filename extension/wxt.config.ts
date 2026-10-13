import { defineConfig } from "wxt";
import { portalOrigins } from "./src/portal.ts";

// Chrome MV3 (ADR 0002, ADR 0005). The toolbar icon opens apply-kit's side panel, which hosts Capture
// and Fill. Both are click-only: no content scripts, and no host permission on any job site at
// install. "activeTab" lets the panel read the tab Kris is on after Kris clicks the icon or presses
// the command; "scripting" runs the one page reader (src/grab.ts) in it. The six portals Fill knows
// are optional hosts, asked for once from a click in the panel ("Allow the 6 portals"). The only hosts
// it talks to are this laptop's apply-kit service. "storage" keeps the service address, the pairing
// token and whether Kris said "Not now" to the portals, nothing else.
export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "apply-kit",
    description: "Capture jobs into your apply-kit Feed, and fill the application portals you're viewing when you click.",
    permissions: ["activeTab", "scripting", "storage", "sidePanel"],
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    optional_host_permissions: portalOrigins,
    action: { default_title: "Open apply-kit" },
    commands: {
      "fill-this-page": { suggested_key: { default: "Alt+Shift+F" }, description: "Fill this page" },
    },
  },
});
