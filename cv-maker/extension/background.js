// CV-maker capture — background service worker.
// Receives postings captured from the page and forwards each to the local
// CV-maker app's /api/discover/ingest (which lands them in the shared pool).

const DEFAULT_APP_URL = "http://localhost:3000";

function getConfig() {
  return new Promise((resolve) =>
    chrome.storage.local.get(
      { appUrl: DEFAULT_APP_URL, autoCapture: true, sentCount: 0 },
      resolve,
    ),
  );
}

// Session-level dedupe so re-scans of the same page don't re-POST.
const sent = new Set();

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "cvm-capture") {
    handleCapture(msg)
      .then(reply)
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true; // async response
  }
  if (msg && msg.type === "cvm-status") {
    getConfig().then(reply);
    return true;
  }
  return false;
});

async function handleCapture(msg) {
  const cfg = await getConfig();
  const base = (cfg.appUrl || DEFAULT_APP_URL).replace(/\/+$/, "");
  let ok = 0;
  let failed = 0;
  for (const p of msg.postings || []) {
    if (!p || !p.url || !p.title) continue;
    const key = msg.source + "|" + p.url + "|" + p.title;
    if (sent.has(key)) continue;
    const payload = {
      source: msg.source || "capture",
      site: msg.site,
      url: p.url,
      title: p.title,
      company: p.company || msg.site || "Unknown",
      location: p.location,
      salary: p.salary,
      description: p.description,
      capturedAt: Date.now(),
    };
    try {
      const res = await fetch(base + "/api/discover/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        ok++;
        sent.add(key);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  if (ok > 0) {
    const total = (cfg.sentCount || 0) + ok;
    await chrome.storage.local.set({ sentCount: total });
    chrome.action.setBadgeText({ text: total > 999 ? "999+" : String(total) });
    chrome.action.setBadgeBackgroundColor({ color: "#1f6feb" });
  }
  return { ok: true, sent: ok, failed };
}
