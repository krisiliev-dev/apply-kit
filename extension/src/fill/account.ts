import type { FieldOutcome, PageReading } from "@apply-kit/core";
import { recognisePortal } from "../portal.ts";
import type { Filler } from "./greenhouse.ts";
import { bindDocument, mark, passwordHint, removeMarks, setValue, showField } from "./page-actions.ts";

function account(doc: Document): PageReading | null {
  const passwords = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  if (!passwords.length) return null;
  const creating = passwords.length > 1 || passwords.some((p) => p.autocomplete === "new-password") || /create (an )?account|създа[йв].*профил/iu.test(doc.querySelector("h1,h2")?.textContent ?? "");
  const fields = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="email"], input[autocomplete="username"], input[type="password"]')).map((el, i) => ({
    id: el.id || el.name || `account-${i}`, label: el.type === "password" ? "Password" : "Email", kind: el.type === "password" ? "text" as const : "email" as const,
    required: el.required, value: el.type === "password" ? "" : el.value, hint: el.type === "password" ? null : "email", options: [], maxLength: null, password: el.type === "password", consent: false,
  }));
  return { pageKind: creating ? "account" : "sign-in", jobRef: recognisePortal(doc.URL).ref, stepLabel: null, stepCount: null, fields };
}

/** Account pages expose only email and password metadata; passwords never enter a page reading. */
export function accountHelp(filler: Filler): Filler {
  const previous = new Map<HTMLInputElement, string>();
  const input = (doc: Document, id: string) => Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="email"], input[autocomplete="username"], input[type="password"]')).find((el, i) => (el.id || el.name || `account-${i}`) === id);
  return {
    ...filler,
    read: (doc) => { bindDocument(doc); return account(doc) ?? filler.read(doc); },
    async fill(doc, answers, files) {
      const reading = account(doc);
      if (!reading) return filler.fill(doc, answers, files);
      if (reading.pageKind === "account") for (const el of Array.from(doc.querySelectorAll('input[type="password"]'))) passwordHint(el);
      return answers.map((a): FieldOutcome => {
        const el = input(doc, a.fieldId);
        if (!el || el.type === "password" || a.kind !== "fill" || !reading.fields.some((f) => f.id === a.fieldId && f.kind === "email")) return { fieldId: a.fieldId, outcome: "skipped", source: null };
        if (el.value) return { fieldId: a.fieldId, outcome: "kept", source: null };
        previous.set(el, el.value);
        const ok = setValue(el, a.value, "Email");
        if (ok) mark(el, "filled", a.fieldId);
        return { fieldId: a.fieldId, outcome: ok ? "filled" : "didnt-stick", source: ok ? a.source : null };
      });
    },
    undo(doc) {
      if (!account(doc)) return filler.undo(doc);
      let restored = 0;
      for (const [el, value] of previous) if (el.ownerDocument === doc && setValue(el, value, "Email")) restored++;
      previous.clear(); removeMarks(doc); return restored;
    },
    show(doc, id) {
      if (!account(doc)) return filler.show(doc, id);
      const el = input(doc, id);
      if (!el) return false;
      showField(el); return true;
    },
  };
}
