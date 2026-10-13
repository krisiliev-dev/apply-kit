# apply-kit interface system (Vitosha)

Source of truth: docs/design/DESIGN.md, docs/design/tokens.json, app/ui/src/styles/tokens.css (moved from docs/design; components.css beside it). Specimen: docs/design/system.html.

- Direction: calm, encouraging, dense. Stone mist ground, white surfaces, pine ink text, pine actions, alpine pink (`--bloom`) only for "needs you" and wins.
- Type: Geologica for headings and numbers, Onest for text (both Cyrillic). 15px body, ratio 1.25. Weight and colour before size.
- Spacing on a 4px grid; controls 8–12px padding, panels 20px, sections 56px.
- Radius: pill for buttons/chips/statuses, 10 for inputs/tables, 14 for panels, 3 for A4 sheets.
- Depth: soft raised shadow in light mode, rules in dark mode.
- Signature: the ascent chart (cumulative applications as a climb).
- States never by colour alone (chips have icons, statuses differ in fill/outline).
- Documents (CV, letter) always on white, single column, one pine accent, fixed template, ligatures off. Geometry and type from the `--doc-*` print tokens (A4, 18mm margins, 9.75pt body).
- Prepare components (DESIGN.md › Added for Prepare): package stepper, sticky action bar, blocked Approve (aria-disabled, explains itself), per-part progress, flag (near the line / gap / low confidence, never pre-selected), choice card, evidence row, change with undo, piece card, drop zone, coach transcript, word count, document frame, section links.
- Honesty decisions are always explicit; amber (`--partly`) marks near-the-line, rose (`--gap`) marks gaps, pink (`--bloom`) marks what needs the user.
