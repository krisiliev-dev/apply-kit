// Track hi-fi helpers shared by applications.html and application.html: the review bar's state
// switcher, a polite announcer, the undo toast (10 s minimum, visible countdown), modal dialogs with
// focus return, chart tooltips, and disclosure buttons. Review chrome only; the app builds its own.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------- announcer ----------
  const live = document.createElement("div");
  live.className = "sr-only"; live.setAttribute("aria-live", "polite"); live.setAttribute("role", "status");
  document.body.appendChild(live);
  const announce = msg => { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 40); };

  // ---------- toast with undo ----------
  let toastEl = null, toastTimer = null;
  const closeToast = () => { clearInterval(toastTimer); toastEl?.remove(); toastEl = null; };
  const toast = (msg, undo, returnFocus) => {
    closeToast();
    let left = 10;
    toastEl = document.createElement("div");
    toastEl.className = "toast"; // announced once through the polite announcer, so no live role here
    toastEl.innerHTML = `<span>${msg}</span>${undo ? `<button class="btn ghost sm" type="button" data-undo>Undo <span class="cd" aria-hidden="true">${left}s</span></button>` : ""}<button class="btn ghost sm x" type="button" data-close aria-label="Dismiss">✕</button>`;
    document.body.appendChild(toastEl);
    announce(msg.replace(/<[^>]+>/g, "") + (undo ? ". Undo available." : ""));
    const cd = $(".cd", toastEl);
    // the countdown pauses while the pointer or focus is inside the toast
    let paused = false;
    toastEl.addEventListener("pointerenter", () => paused = true); toastEl.addEventListener("pointerleave", () => paused = false);
    toastEl.addEventListener("focusin", () => paused = true); toastEl.addEventListener("focusout", () => paused = false);
    toastTimer = setInterval(() => { if (paused) return; left--; if (cd) cd.textContent = left + "s"; if (left <= 0) { closeToast(); returnFocus?.focus?.(); } }, 1000);
    $("[data-undo]", toastEl)?.addEventListener("click", () => { closeToast(); undo(); returnFocus?.focus?.(); });
    $("[data-close]", toastEl).addEventListener("click", () => { closeToast(); returnFocus?.focus?.(); });
  };

  // ---------- dialogs ----------
  let opener = null;
  const openDialog = (id, from) => {
    const d = document.getElementById(id); if (!d) return;
    opener = from || document.activeElement;
    d.showModal();
    (d.querySelector("[autofocus]") || d.querySelector("h2"))?.focus();
  };
  document.addEventListener("click", e => {
    const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); openDialog(o.dataset.open, o); return; }
    const c = e.target.closest("[data-dismiss]");
    if (c) { e.preventDefault(); const d = c.closest("dialog"); d.close(); }
  });
  document.addEventListener("close", e => { if (e.target.matches("dialog")) { opener?.focus?.(); } }, true);

  // ---------- disclosure ----------
  document.addEventListener("click", e => {
    const b = e.target.closest("button[aria-controls][aria-expanded]:not([data-menu])"); if (!b) return;
    const p = document.getElementById(b.getAttribute("aria-controls")); if (!p) return;
    const open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(open)); p.hidden = !open;
  });

  // ---------- chart tooltips (hover and keyboard focus) ----------
  const tipFor = hit => {
    const wrap = hit.closest(".chart-wrap"); let tip = $(".chart-tip", wrap);
    if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; tip.setAttribute("aria-hidden", "true"); wrap.appendChild(tip); }
    const r = hit.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    tip.textContent = hit.getAttribute("aria-label"); tip.hidden = false;
    tip.style.left = Math.min(Math.max(r.left - w.left + r.width / 2, 60), w.width - 60) + "px"; tip.style.top = (r.top - w.top - 4) + "px";
  };
  const hideTip = hit => { const t = $(".chart-tip", hit.closest(".chart-wrap")); if (t) t.hidden = true; };
  document.addEventListener("pointerover", e => { const h = e.target.closest?.(".chart .hit"); if (h) tipFor(h); });
  document.addEventListener("pointerout", e => { const h = e.target.closest?.(".chart .hit"); if (h) hideTip(h); });
  document.addEventListener("focusin", e => { const h = e.target.closest?.(".chart .hit"); if (h) tipFor(h); });
  document.addEventListener("focusout", e => { const h = e.target.closest?.(".chart .hit"); if (h) hideTip(h); });

  // ---------- review state switcher ----------
  const init = (opts = {}) => {
    const states = $$("[data-state]"), bar = $(".review .states");
    const show = id => {
      states.forEach(s => s.hidden = s.dataset.state !== id);
      bar.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === id)));
      $$("dialog[open]").forEach(d => d.close());
      closeToast();
      opts.onShow?.(id);
    };
    states.forEach(s => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.t = s.dataset.state; b.textContent = s.dataset.stateName;
      b.onclick = () => { history.replaceState(null, "", "#" + s.dataset.state); show(s.dataset.state); };
      bar.appendChild(b);
    });
    window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (states.some(s => s.dataset.state === h)) { show(h); window.scrollTo(0, 0); } });
    const first = states.some(s => s.dataset.state === location.hash.slice(1)) ? location.hash.slice(1) : states[0].dataset.state;
    show(first);
    return { show };
  };

  window.Track = { $, $$, esc, announce, toast, closeToast, openDialog, init };
})();
