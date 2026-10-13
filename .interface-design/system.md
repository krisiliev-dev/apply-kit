# apply-kit interface system (Vitosha)

Source of truth: docs/design/DESIGN.md, docs/design/tokens.json, app/ui/src/styles/tokens.css (moved from docs/design; components.css beside it). Specimen: docs/design/system.html.

- Direction: calm, encouraging, dense. Stone mist ground, white surfaces, pine ink text, pine actions, alpine pink (`--bloom`) only for "needs you" and wins.
- Type: Geologica for headings and numbers, Onest for text (both Cyrillic). 15px body, ratio 1.25. Weight and colour before size.
- Spacing on a 4px grid; controls 8–12px padding, panels 20px, sections 56px.
- Radius: pill for buttons/chips/statuses, 10 for inputs/tables, 14 for panels, 3 for A4 sheets.
- Depth: soft raised shadow in light mode, rules in dark mode.
- Signature: the ascent chart (cumulative applications as a climb).
- States never by colour alone (chips have icons, statuses differ in fill/outline).
- Documents (CV, letter) always on white, single column, one pine accent, fixed template, ligatures off.
- Track: no Send buttons anywhere (Copy text, Open in Mail, Mark sent); every Event carries a cause tag (by email / by you / by apply-kit); automatic changes show their reason and Undo; no opacity fading for done or closed items; partial data marks are hatched; weekly chart is one pine series, pink only when the current week beats the pace.
