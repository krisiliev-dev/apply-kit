import { defineManifest } from "@crxjs/vite-plugin";

// MV3 manifest. Keep permissions minimal; we only need storage + activeTab + scripting.
// Host permissions are <all_urls> because application forms show up on arbitrary domains
// (company career pages, Greenhouse, Lever, Ashby, Workday, …).
export default defineManifest({
  manifest_version: 3,
  name: "CV Autofill",
  description:
    "Learns answers you give to job-application forms and suggests them on new ones. Never auto-submits.",
  version: "0.1.0",
  action: {
    default_title: "CV Autofill",
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png",
    },
  },
  icons: {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/observer.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
    {
      // Job-posting capture: LinkedIn / Indeed / Glassdoor only. Narrowly scoped
      // so the capture pill never appears on unrelated pages. We only read the
      // DOM the user is already viewing — no network calls to these hosts.
      matches: [
        "*://*.linkedin.com/*",
        "*://*.indeed.com/*",
        "*://*.glassdoor.com/*",
      ],
      js: ["src/content/jobCapture.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  permissions: ["storage", "activeTab", "scripting"],
  // <all_urls> covers the autofill observer on arbitrary application pages.
  // The three job-board patterns are listed explicitly so the intent is
  // obvious on review; they are already a subset of <all_urls>.
  host_permissions: [
    "<all_urls>",
    "*://*.linkedin.com/*",
    "*://*.indeed.com/*",
    "*://*.glassdoor.com/*",
  ],
  web_accessible_resources: [
    {
      resources: ["src/content/*", "assets/*"],
      matches: ["<all_urls>"],
    },
  ],
});
