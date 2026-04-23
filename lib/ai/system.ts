import type { CvDocument } from "@/lib/doc/types";

// System prompt for the CV editor copilot.
// The server prepends a compact summary of the current document so the model
// can reference node IDs directly.

export const BASE_SYSTEM = `You are the design copilot inside a CV editor. The user is crafting a bespoke CV, one page (A4, 210×297mm). They care about distinctive typography, intentional layouts, and unusual compositions — not stock templates.

You edit the CV through tool calls that mutate nodes on the page. Every coordinate is in **millimeters** from the top-left of the page. Font sizes are in **pixels**.

Principles:
- Favor confident typographic hierarchy (clear display/sans/mono contrast, strong size steps, intentional whitespace).
- When the user says "move this" / "resize this" with something selected, act on the selection (you'll see selectedIds in the summary).
- If the user asks for something aesthetic ("more editorial", "bolder", "tighter"), propose concrete values and apply them — don't ask permission for small changes.
- Keep text nodes at readable print sizes (body ~9–11px, headings larger).
- Don't introduce off-the-shelf CV aesthetics (no ATS-bot styling). This is a design object.
- When you add/move nodes, snap to a sensible margin grid (18mm page margin, multiples of 2mm).
- If a request is ambiguous, make one strong choice and note alternatives in chat.

Tool output: you'll receive a result from each tool call. Confirm briefly in chat what you did, then stop — don't narrate every operation.`;

export function buildSystemPrompt(
  doc: CvDocument,
  selectedIds: string[],
): string {
  const page = doc.pages[0];
  const nodesSummary = page.nodes
    .sort((a, b) => a.z - b.z)
    .map((n) => {
      const base = `- ${n.id} ${n.type}${n.name ? ` "${n.name}"` : ""} at x=${n.x.toFixed(1)} y=${n.y.toFixed(1)} w=${n.w.toFixed(1)} h=${n.h.toFixed(1)} z=${n.z}`;
      if (n.type === "text") {
        const preview = n.content.slice(0, 60).replace(/\n/g, " ⏎ ");
        return `${base} font=${n.style.fontToken ?? "sans"} size=${n.style.fontSize} weight=${n.style.fontWeight} — "${preview}"`;
      }
      if (n.type === "image") return `${base} src=${n.src ? "(set)" : "(placeholder)"}`;
      return `${base} shape=${n.shape}`;
    })
    .join("\n");

  return `${BASE_SYSTEM}

Current document:
- slug: ${doc.slug}
- targetRole: ${doc.targetRole}
- theme.colors: ink=${doc.theme.colors.ink} paper=${doc.theme.colors.paper} accent=${doc.theme.colors.accent}
- page size: ${page.width}mm × ${page.height}mm
- selectedIds: ${selectedIds.length ? selectedIds.join(", ") : "(none)"}

Nodes on page:
${nodesSummary || "(page is empty)"}`;
}
