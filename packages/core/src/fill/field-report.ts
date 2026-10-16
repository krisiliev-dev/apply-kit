// Field reports (Apply spec #23, #48): "Report this field" keeps a portal field's structure (tag, type,
// role, attributes, label chain, options) with where it was (portal, host, path; never the query),
// so a filler can be fixed later. Never a value. Pure and browser-safe: keeping only the structure,
// and the report as a fixture snippet ("Copy as fixture"), which #50 turns into synthetic fixtures.
import type { FieldKind, FieldReport, FieldStructure } from "./reading.ts";

const kinds: FieldKind[] = ["text", "email", "tel", "url", "textarea", "number", "date", "select", "typeahead", "radio", "checkbox", "file"];
/** Attributes that describe a field. `value` and anything that carries one (aria-valuetext, aria-valuenow, aria-activedescendant) never. */
export const describingAttribute = /^(id|name|class|type|role|autocomplete|maxlength|minlength|required|placeholder|pattern|inputmode|accept|multiple|min|max|step|disabled|readonly|for|data-qa|data-testid|data-automation-id|aria-(?!value|activedescendant)[a-z]+)$/;
const text = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Only the structure of what the extension sent: known keys, describing attributes, strings of bounded length. */
export function fieldStructure(sent: unknown): FieldStructure | null {
  const f = sent as Partial<Record<keyof FieldStructure, unknown>> | null;
  const tag = text(f?.tag, 40)?.toLowerCase();
  if (!f || !tag || !/^[a-z][a-z0-9-]*$/.test(tag)) return null;
  const attributes: Record<string, string> = {};
  if (f.attributes && typeof f.attributes === "object") {
    for (const [k, v] of Object.entries(f.attributes as Record<string, unknown>)) if (describingAttribute.test(k) && typeof v === "string") attributes[k] = v.slice(0, 500);
  }
  const chain = Array.isArray(f.labelChain) ? f.labelChain : [];
  return {
    tag,
    type: text(f.type, 40),
    role: text(f.role, 40),
    kind: kinds.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : "text",
    attributes,
    labelChain: chain.flatMap((l: { from?: unknown; text?: unknown }) => {
      const from = text(l?.from, 60);
      const t = text(l?.text);
      return from && t ? [{ from, text: t }] : [];
    }).slice(0, 10),
    options: (Array.isArray(f.options) ? f.options : []).flatMap((o) => (text(o, 200) ? [text(o, 200)!] : [])).slice(0, 300),
  };
}

/** The page's host and path from its address: the query and fragment are never kept. */
export function whereReported(address: string): { host: string; path: string } | null {
  try {
    const u = new URL(address);
    return { host: u.hostname, path: u.pathname };
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrs = (a: Record<string, string>) => Object.entries(a).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");

/** "Copy as fixture": the report as an HTML snippet with a comment saying where it came from. Structure only. */
export function fieldReportFixture(r: FieldReport): string {
  const f = r.field;
  const label = f.labelChain[0]?.text ?? "";
  const chain = f.labelChain.map((l) => `${l.from} "${l.text}"`).join(" · ") || "none";
  const where = `${r.portal} · ${r.host}${r.path}${r.stepLabel ? ` · step "${r.stepLabel}"` : ""} · reported ${r.createdAt.slice(0, 10)}`;
  const head = [
    `<!-- Field report: ${where.replace(/--/g, "- -")}. Structure only, no values.`,
    `     Label chain: ${chain.replace(/--/g, "- -")}. Wrap it in the portal's form to make a synthetic fixture. -->`,
  ];
  const id = f.attributes.id;
  let body: string[];
  if (f.kind === "radio") {
    const name = f.attributes.name ?? id ?? "field";
    body = [`<fieldset>`, `  <legend>${esc(label)}</legend>`, ...f.options.map((o) => `  <label><input type="radio" name="${esc(name)}"> ${esc(o)}</label>`), `</fieldset>`];
  } else if (f.tag === "select") {
    body = [`<div class="field">`, `  <label${id ? ` for="${esc(id)}"` : ""}>${esc(label)}</label>`, `  <select${attrs(f.attributes)}><option value="">Select…</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`, `</div>`];
  } else {
    const el = f.tag === "textarea" ? `<textarea${attrs(f.attributes)}></textarea>` : `<${f.tag}${attrs(f.attributes)}>`;
    body = [`<div class="field">`, `  <label${id ? ` for="${esc(id)}"` : ""}>${esc(label)}</label>`, `  ${el}`, `</div>`];
  }
  return [...head, ...body].join("\n");
}
