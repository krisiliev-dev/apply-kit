# apply-kit

A personal toolkit for applying to jobs. It has three goals:

1. **Generate and tailor CVs** (and cover letters) for each role.
2. **Apply to jobs** with as little repetitive work as possible.
3. **Discover jobs** automatically from job boards, ATS feeds and alerts.

## Status: archive snapshot

This commit is an **archive** of the earlier prototypes. A new project will replace these files, built design-first. Git history keeps this snapshot for reference.

| Part | Path | Goals | State |
|---|---|---|---|
| CV-maker web app | `cv-maker/` | 1, 3 (partly 2) | Working local-first Next.js 16 app: canvas CV editor + AI copilot, tailoring, cover letters, CV evaluation ("recruiter eye", six-second test, archetypes), application tracker, follow-ups, career advisor, discovery queue (Greenhouse/Lever/Ashby/SmartRecruiters/Workday/dev.bg/HN/RSS/Reed/Jooble/EURES/…), email-alert ingestion, MCP server, capture extension. Doesn't submit applications. |
| Autofill extension | `autofill-extension/` | 2, 3 | Chrome MV3 extension (Vite + React) that learns your answers on application forms and suggests them later; pairs with CV-maker. Never auto-submits. |
| Research notes | `docs/research/` | all | The previous agent's findings: job-source landscape, ToS/scraping limits (LinkedIn, jobs.bg), free job APIs, run setup, no-personal-data rule. |

## Rules carried forward

- Never commit real CVs, profile data or secrets. Personal data stays local (`.gitignore` covers `.env*`, PDFs/DOCX/Pages and personal folders).
- No automation that drives authenticated LinkedIn/jobs.bg sessions or defeats bot protection. Use official APIs, email alerts and user-driven capture instead.
