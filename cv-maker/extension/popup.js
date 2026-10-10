const DEFAULT_APP_URL = "http://localhost:3000";

const appUrlEl = document.getElementById("appUrl");
const autoEl = document.getElementById("autoCapture");
const statusEl = document.getElementById("status");
const captureBtn = document.getElementById("captureNow");

function setStatus(msg) {
  statusEl.textContent = msg;
}

// Load config into the form.
chrome.storage.local.get(
  { appUrl: DEFAULT_APP_URL, autoCapture: true, sentCount: 0 },
  (cfg) => {
    appUrlEl.value = cfg.appUrl;
    autoEl.checked = cfg.autoCapture;
    setStatus(`${cfg.sentCount || 0} captured this session.`);
  },
);

appUrlEl.addEventListener("change", () => {
  chrome.storage.local.set({ appUrl: appUrlEl.value.trim() || DEFAULT_APP_URL });
});

autoEl.addEventListener("change", () => {
  chrome.storage.local.set({ autoCapture: autoEl.checked });
});

captureBtn.addEventListener("click", async () => {
  setStatus("Capturing…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("No active tab.");
    return;
  }
  try {
    // Inject the content script (works on any site via activeTab), then ask it
    // to capture immediately.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    chrome.tabs.sendMessage(tab.id, { type: "cvm-capture-now" }, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus("Couldn't read this page (try a job listing/detail page).");
        return;
      }
      const n = (resp && resp.captured) || 0;
      setStatus(n > 0 ? `Captured ${n} posting${n === 1 ? "" : "s"}.` : "No postings found on this page.");
    });
  } catch (e) {
    setStatus("Capture failed: " + (e && e.message ? e.message : e));
  }
});
