# apply-kit

Personal toolkit that takes the time-consuming, high-friction steps out of applying to jobs:
tailoring CVs, discovering and filtering jobs, filling application portals, outreach, and tracking.

- Current state: archive of the old prototypes (`cv-maker/`, `autofill-extension/`, tag `archive-2026-10`),
  about to be replaced by a design-first rebuild. Treat the archive as reference only.
- Design comes first: follow the `design-process` skill; deliverables live in `docs/design/`
  (start with `docs/design/friction-map.md`).
- Knowledge from the old project: `docs/knowledge/` and `docs/research/`.
- Never commit real CVs, personal data or secrets. Personal data stays local.
- The app drafts and pre-fills; the user sends messages and presses Submit. No automation of
  LinkedIn sessions or bot-protected sites.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for krisiliev-dev/apply-kit (via `gh`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created as terms and decisions are settled. See `docs/agents/domain.md`.
