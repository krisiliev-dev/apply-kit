# apply-kit

Personal toolkit that takes the time-consuming, high-friction steps out of applying to jobs:
tailoring CVs, discovering and filtering jobs, filling application portals, outreach, and tracking.

- Current state: design-first rebuild in progress (pnpm workspace: `app/`, `app/ui/`, `packages/core/`, `extension/`;
  see README.md). The old prototypes are only in history and the `archive-2026-10` tag; reference only.
- Design comes first: follow the `design-process` skill; deliverables live in `docs/design/`
  (start with `docs/design/friction-map.md`).
- Knowledge from the old project: `docs/knowledge/` and `docs/research/`.
- Never commit real CVs, personal data or secrets. Personal data stays local.
- **Never open, read, print or search `.env`** (it holds the user's API keys), and never search inside `data/` (the user's personal database). Refer to settings by name only.
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and decisions in `docs/adr/`. Design system: [docs/design/DESIGN.md](docs/design/DESIGN.md); use tokens from `app/ui/src/styles/tokens.css` (with `components.css` beside it; both shared by the app and the hi-fi screens), never raw values.
- The app drafts and pre-fills; the user sends messages and presses Submit. No automation of
  LinkedIn sessions or bot-protected sites.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for krisiliev-dev/apply-kit (via `gh`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created as terms and decisions are settled. See `docs/agents/domain.md`.
