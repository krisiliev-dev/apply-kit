import type { FieldContext, MatchResult } from "../shared/types";

// Suggestion tooltip — a shadow-DOM island attached to document.body.
// We use a single shared host and reposition it as focus moves, instead of
// one-per-field, to keep DOM noise minimal.

type Action = "accept" | "edit" | "skip";

export interface SuggestCallbacks {
  onAccept: (value: string) => void;
  onEdit: (value: string) => void;
  onSkip: () => void;
}

const HOST_ID = "cvaf-suggest-host";

let hostEl: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let activeField: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

function ensureHost(): { host: HTMLDivElement; root: ShadowRoot } {
  if (hostEl && shadow) return { host: hostEl, root: shadow };
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "z-index:2147483646",
    "pointer-events:none",
  ].join(";");
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        pointer-events: auto;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: #fafaf7;
        color: #111111;
        border: 1px solid #111111;
        border-radius: 6px;
        box-shadow: 0 8px 28px rgba(0,0,0,.18);
        padding: 8px 10px;
        min-width: 240px;
        max-width: 360px;
        font-size: 12px;
        line-height: 1.35;
        display: none;
      }
      .card.open { display: block; }
      .label {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px;
        letter-spacing: .1em;
        text-transform: uppercase;
        color: #6b6b6b;
        margin-bottom: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .conf { color: #d64933; }
      .value {
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 120px;
        overflow-y: auto;
        margin-bottom: 8px;
      }
      textarea {
        width: 100%;
        min-height: 72px;
        font: inherit;
        color: #111;
        background: #fff;
        border: 1px solid #111;
        border-radius: 4px;
        padding: 4px 6px;
        box-sizing: border-box;
        resize: vertical;
      }
      .row { display: flex; gap: 6px; justify-content: flex-end; }
      button {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        background: #111;
        color: #fafaf7;
        border: 1px solid #111;
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
      }
      button.ghost { background: transparent; color: #111; }
      button.accent { background: #d64933; border-color: #d64933; }
      .hint {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 9px;
        color: #6b6b6b;
        margin-top: 4px;
      }
    </style>
    <div class="card" role="dialog" aria-label="Autofill suggestion">
      <div class="label">
        <span data-label>suggestion</span>
        <span class="conf" data-conf></span>
      </div>
      <div data-view="show">
        <div class="value" data-value></div>
        <div class="row">
          <button class="ghost" data-act="skip">Skip</button>
          <button class="ghost" data-act="edit">Edit</button>
          <button class="accent" data-act="accept">Accept</button>
        </div>
        <div class="hint">Tab to accept, Esc to dismiss</div>
      </div>
      <div data-view="edit" style="display:none">
        <textarea data-editor></textarea>
        <div class="row" style="margin-top:6px">
          <button class="ghost" data-act="cancel-edit">Cancel</button>
          <button class="accent" data-act="save-edit">Save</button>
        </div>
      </div>
    </div>
  `;
  hostEl = host;
  shadow = root;
  return { host, root };
}

function positionHostNear(el: HTMLElement): void {
  const { host } = ensureHost();
  const rect = el.getBoundingClientRect();
  const top = window.scrollY + rect.bottom + 6;
  const left = window.scrollX + rect.left;
  host.style.transform = `translate(${left}px, ${top}px)`;
}

export function hideSuggestion(): void {
  if (!shadow) return;
  const card = shadow.querySelector<HTMLDivElement>(".card");
  card?.classList.remove("open");
  activeField = null;
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

export function showSuggestion(
  field: HTMLElement,
  ctx: FieldContext,
  match: MatchResult,
  cbs: SuggestCallbacks,
): void {
  const { root } = ensureHost();
  activeField = field;
  positionHostNear(field);

  const card = root.querySelector<HTMLDivElement>(".card");
  const labelEl = root.querySelector<HTMLElement>("[data-label]");
  const confEl = root.querySelector<HTMLElement>("[data-conf]");
  const valueEl = root.querySelector<HTMLElement>("[data-value]");
  const editor = root.querySelector<HTMLTextAreaElement>("[data-editor]");
  const viewShow = root.querySelector<HTMLElement>('[data-view="show"]');
  const viewEdit = root.querySelector<HTMLElement>('[data-view="edit"]');
  if (!card || !labelEl || !confEl || !valueEl || !editor || !viewShow || !viewEdit) return;

  labelEl.textContent = truncate(ctx.label, 48);
  confEl.textContent = `${Math.round(match.confidence * 100)}%`;
  valueEl.textContent = match.suggestion;
  editor.value = match.suggestion;
  viewShow.style.display = "block";
  viewEdit.style.display = "none";
  card.classList.add("open");

  const complete = (act: Action, value?: string): void => {
    hideSuggestion();
    if (act === "accept") cbs.onAccept(match.suggestion);
    else if (act === "edit") cbs.onEdit(value ?? editor.value);
    else cbs.onSkip();
  };

  const onClick = (ev: Event): void => {
    const target = ev.target as HTMLElement;
    const act = target.getAttribute?.("data-act");
    if (!act) return;
    ev.preventDefault();
    if (act === "accept") complete("accept");
    else if (act === "skip") complete("skip");
    else if (act === "edit") {
      viewShow.style.display = "none";
      viewEdit.style.display = "block";
      editor.focus();
      editor.select();
    } else if (act === "cancel-edit") {
      viewShow.style.display = "block";
      viewEdit.style.display = "none";
    } else if (act === "save-edit") {
      complete("edit", editor.value);
    }
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (!activeField) return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      complete("skip");
    } else if (ev.key === "Tab" && !ev.shiftKey && document.activeElement === activeField) {
      // Tab-to-accept only while the field itself is focused.
      ev.preventDefault();
      complete("accept");
    }
  };

  const onScroll = (): void => {
    if (activeField) positionHostNear(activeField);
  };
  const onResize = (): void => {
    if (activeField) positionHostNear(activeField);
  };

  card.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  activeCleanup = (): void => {
    card.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
