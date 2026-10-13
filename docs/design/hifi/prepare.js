// Shared behaviour for the Prepare hi-fi screens (profile, onboarding, package, cv-template).
// Review chrome only: the state switcher, disclosure toggles, a polite status region and toasts.
// Not app code. Fictional demo data only.
(function () {
  const icon = {
    met: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    partly: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor"/></svg>',
    gap: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    ask: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.3 4.4a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="9.8" r=".9" fill="currentColor"/></svg>',
    line: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2.4M6 8.9v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.6v3M6 8.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="5.2" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 5.2V4a2 2 0 0 1 4 0v1.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    wait: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="1.2" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h4l2 2v7H3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  };
  window.akIcon = icon;
  document.querySelectorAll("[data-i]").forEach(el => {
    el.insertAdjacentHTML("afterbegin", icon[el.dataset.i] || "");
    if (el.dataset.sr) el.insertAdjacentHTML("beforeend", `<span class="sr-only">, ${el.dataset.sr}</span>`);
  });
  document.querySelectorAll("[data-spin]").forEach(el => el.innerHTML = '<span class="spin" aria-hidden="true"></span>');

  // one always-present polite status region per page
  const live = document.getElementById("live");
  const announce = msg => { if (!live) return; live.textContent = ""; setTimeout(() => live.textContent = msg, 60); };
  window.akAnnounce = announce;

  // toast with optional Undo: 15 s, visible countdown, paused on hover or focus
  const host = document.getElementById("toast-host");
  let timer = null;
  const closeToast = () => { clearInterval(timer); if (host) host.innerHTML = ""; };
  window.akToast = (msg, undo) => {
    if (!host) return announce(msg);
    clearInterval(timer);
    host.innerHTML = `<div class="toast"><span>${msg}</span>${undo ? '<button class="btn ghost sm" type="button" data-undo>Undo<span class="cd" aria-hidden="true"> · 15 s</span></button>' : ""}<button class="btn ghost sm" type="button" data-dismiss aria-label="Dismiss">✕</button></div>`;
    announce(msg + (undo ? " Undo is available." : ""));
    const t = host.firstElementChild; let left = undo ? 15 : 6, paused = false;
    t.addEventListener("mouseenter", () => paused = true); t.addEventListener("mouseleave", () => paused = t.contains(document.activeElement));
    t.addEventListener("focusin", () => paused = true); t.addEventListener("focusout", e => { if (!t.contains(e.relatedTarget)) paused = t.matches(":hover"); });
    if (undo) t.querySelector("[data-undo]").addEventListener("click", () => { closeToast(); undo(); });
    t.querySelector("[data-dismiss]").addEventListener("click", closeToast);
    timer = setInterval(() => { if (paused) return; left--; const cd = t.querySelector(".cd"); if (cd) cd.textContent = ` · ${left} s`; if (left <= 0) closeToast(); }, 1000);
  };

  // review state switcher (hash-addressable)
  const states = [...document.querySelectorAll("[data-state]")];
  const bar = document.querySelector(".review .states");
  // focus after a state change: an alert that explains a refusal first, else the state's heading
  const focusHead = id => { const h = document.querySelector(`[data-state="${id}"] [data-autofocus], [data-state="${id}"] h1, [data-state="${id}"] h2`); if (h) { if (!h.hasAttribute("tabindex")) h.tabIndex = -1; h.focus({ preventScroll: true }); } };
  const show = (id, focus) => {
    states.forEach(s => s.hidden = s.dataset.state !== id);
    bar?.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === id)));
    document.dispatchEvent(new CustomEvent("ak:state", { detail: id }));
    window.scrollTo(0, 0);
    if (focus) focusHead(id);
  };
  window.akShow = show;
  states.forEach(s => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab"); b.dataset.t = s.dataset.state; b.textContent = s.dataset.stateName;
    b.onclick = () => { closeToast(); history.replaceState(null, "", "#" + s.dataset.state); show(s.dataset.state); };
    bar?.appendChild(b);
  });

  document.addEventListener("click", e => {
    // an aria-disabled Approve explains itself: focus moves to what blocks it
    const blocked = e.target.closest("[data-blocked]");
    if (blocked) { const el = document.getElementById(blocked.dataset.blocked); const why = document.getElementById(blocked.getAttribute("aria-describedby")); if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); } if (why) announce("Can't approve yet: " + why.textContent); return; }
    const t = e.target.closest("[data-toggle]");
    if (t) { const el = document.getElementById(t.dataset.toggle); el.hidden = !el.hidden; t.setAttribute("aria-expanded", String(!el.hidden)); return; }
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); history.replaceState(null, "", "#" + g.dataset.go); show(g.dataset.go, true); if (g.dataset.say) announce(g.dataset.say); return; }
    const a = e.target.closest("[data-say]");
    if (a) { announce(a.dataset.say); }
    const z = e.target.closest("[data-zoom]");
    if (z) {
      const frame = z.closest(".doc-frame");
      frame.classList.toggle("fit", z.dataset.zoom === "fit");
      z.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b === z)));
    }
  });
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (states.some(s => s.dataset.state === h)) show(h); });
  const first = states.some(s => s.dataset.state === location.hash.slice(1)) ? location.hash.slice(1) : states[0]?.dataset.state;
  if (first) show(first);
})();
