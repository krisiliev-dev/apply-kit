// apply-kit wireframes: state switcher + small shared behaviours.
// Each page has <section data-state="id" data-state-name="Label" data-note-id="..."> blocks inside .screen
// and optional <div class="notes" data-notes-for="id"> blocks; the switcher shows one state at a time.
(function () {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const states = $$("[data-state]");
  const bar = document.querySelector(".states");
  if (bar && states.length) {
    const show = id => {
      states.forEach(s => s.hidden = s.dataset.state !== id);
      $$("[data-notes-for]").forEach(n => n.hidden = n.dataset.notesFor !== id);
      $$(".state-tab", bar).forEach(t => t.setAttribute("aria-selected", t.dataset.target === id));
    };
    states.forEach(s => {
      const b = document.createElement("button");
      b.className = "state-tab"; b.type = "button"; b.setAttribute("role", "tab");
      b.dataset.target = s.dataset.state; b.textContent = s.dataset.stateName || s.dataset.state;
      b.addEventListener("click", () => show(s.dataset.state));
      bar.appendChild(b);
    });
    const fromHash = location.hash.slice(1);
    show(states.some(s => s.dataset.state === fromHash) ? fromHash : states[0].dataset.state);
  }
  // collapsible groups: <button data-toggle="id">▸ Label</button>
  $$("[data-toggle]").forEach(b => b.addEventListener("click", () => {
    const el = document.getElementById(b.dataset.toggle); if (!el) return;
    el.hidden = !el.hidden;
    b.setAttribute("aria-expanded", String(!el.hidden));
    b.textContent = b.textContent.replace(/^[▸▾]/, el.hidden ? "▸" : "▾");
  }));
})();
