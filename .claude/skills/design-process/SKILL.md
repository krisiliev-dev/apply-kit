---
name: design-process
description: The project's end-to-end product design process (frame, map, concepts, wireframes, design system, hi-fi, critique, accessibility audit, user testing, design QA). Use before designing or redesigning any screen, flow or feature, when the user asks "where are we in design", or says "design process", "next design step", or starts a new feature that has UI.
argument-hint: "[step number or name, or a feature to run through the process]"
---

# Design process

How apply-kit gets designed: a lean version of what product designers do every day (Double Diamond as the mental model, Lean UX loops, JTBD framing, design systems with tokens, Nielsen heuristics, WCAG 2.2 AA, 5-user usability tests). No code for a screen before its design steps are done.

All deliverables live in `docs/design/`. Before starting, read what exists there and report which step the project (or the given feature) is at. Do one step at a time, show the deliverable, and get the user's decision before moving on: the agent proposes and critiques, the user decides.

## Foundation (once, revisit when the product changes)

1. **Frame** → `docs/design/PRODUCT.md`
   Users, the top 3 jobs as JTBD statements ("When I…, I want to…, so I can…"), success metrics, non-goals, riskiest assumptions. Use the `jobs-to-be-done` skill; mine `docs/knowledge/` and `docs/research/` for what we already learned. Use `grilling` to stress-test it with the user.

2. **Map** → `docs/design/flows.md`
   Core journey (discover → judge fit → tailor CV → apply → track → follow up) with the emotional low points, information architecture (sitemap), and the domain objects (Job, Application, CV version, Contact…). Use `journey-map`; record terms in the glossary via `domain-modeling`.

3. **Diverge, then converge** → `docs/design/concepts.md`
   2–3 genuinely different concepts for each key screen (different in what the user does, not just looks), then pick against criteria written down beforehand, noting what each rejected concept taught us. Use `parallel-concepts`, then `concept-selection`.

4. **Wireframe** → greyscale HTML in `docs/design/wireframes/`
   Real content and copy first. Every state of each key screen: empty, loading, error, partial, overflow/long content, first-run. Use `form-design`, `loading-states`, `error-handling-ux`, `search-ux` where they apply. Publish them as artifacts so the user can click through.

5. **Design system** → `docs/design/DESIGN.md` + tokens (W3C DTCG format) + `.interface-design/system.md`
   A deliberate visual direction (from `frontend-design`: grounded in the subject, not generic), tokens for colour, type scale, spacing (4/8 grid), radius, elevation and motion, and ~10 core components with all their states. Use `design-token`, `component-spec`, `interface-design`. Light and dark from the start.

## Per feature (loop: Lean UX)

6. **Hi-fi** → apply the tokens to the chosen wireframes. Hierarchy through weight and colour before size, generous spacing, restrained palette. Tokens only, no raw hex or one-off spacing.

7. **Critique** → `docs/design/critique/<feature>.md`
   Nielsen's 10 heuristics, a severity of 0–4 per finding, and a fix for each. Use `heuristic-evaluation`. Fix severity 3–4 before building.

8. **Accessibility and code audit** → findings as `file:line`
   WCAG 2.2 AA: contrast 4.5:1 (3:1 for large text and UI), visible keyboard focus, 24px minimum targets, labels, reduced motion. Use `accessibility-audit` on the design, and `web-design-guidelines` on the built code.

9. **Test with 3–5 users** → `docs/design/research/<round>.md`
   Task-based script (e.g. "tailor your CV for this posting and log the application"), think-aloud, findings ranked by severity. Use `usability-test-plan` and `interview-script`. Once per major release; the user may be the first participant.

10. **Design QA and handoff** → checklist in the feature's ticket
    Build matches `DESIGN.md`: tokens only, every state built, responsive at 375 / 768 / 1280, keyboard path works. Use `handoff-spec` before building and `design-qa-checklist` after. Update `DESIGN.md` and `.interface-design/system.md` with anything new so future sessions stay consistent.

## Hand-off to engineering

When a feature has passed step 7, it goes to the engineering flow: `to-spec` → `to-tickets` → `implement-spec` (with `tdd`), then step 8's code audit and step 10's QA.

## Rules

- Never skip states: an empty, loading or error screen designed later is a bug designed in.
- Design with realistic data (long company names, 200 applications, no applications), never lorem ipsum. Never put the user's real CV or personal data into design files: use the fictional demo persona.
- Keep it lean (see `ponytail`): the fewest screens that do the job. The old prototype grew to ~17 routes; every new screen must earn its place against the core journey.
