# Knowledge from the old prototype

Extracted 2026-10-11 from the archived `cv-maker/` and `autofill-extension/` (tag `archive-2026-10`). Each section is tagged by evidence level: **cited** (a source is named), **convention** (common practice), or **invented** (an arbitrary heuristic the previous agent chose). Almost nothing was cited, and every exact number and weight is invented, so treat them as starting guesses to validate, not facts.

| Doc | Covers | Strongest ideas to rebuild |
|---|---|---|
| [cv-writing-and-evaluation.md](cv-writing-and-evaluation.md) | 6-second scan, recruiter triage, numbers/proof/tenure checks, keywords and ATS parseability, ~40 cliché phrases with replacements, scoring model, rewriting rules | No-fabrication guards when tailoring; 6-second test on the rendered PDF; parser-loss map; recruiter critique format (1 signal, 1 weakness, 1 fix, ≤6 issues) |
| [application-tactics.md](application-tactics.md) | Fit check and role tiers, pre-screen answers, cover letters, follow-up cadence, interview prep, salary, rejection lessons, pacing, advisor lenses, ATS prefill, funnel metrics | Fit check before effort; follow-up cadence per stage; "quality over spray" pacing signal; field-by-field ATS prefill (never submit) |
| [job-discovery.md](job-discovery.md) | 17 source adapters, ToS boundary, dedupe/expiry, ranking model, email-alert ingestion, capture extensions, autofill Q&A matching | Reed, Jooble, dev.bg, SmartRecruiters, Workday, EURES+ESCO, Greenhouse/Lever/Ashby; JSON-LD-first extraction; email alerts; click-only capture; autofill matching tiers |

Known bugs in the old code to avoid repeating (details in the docs): failed source fetches closing live postings, timestamped IDs creating duplicates, captured postings never expiring, Cyrillic stripped from ranking, substring location matching ("uk" matches "Ukraine"), uncalibrated default scores.

See also `docs/research/previous-agent/` for the source landscape and ToS research.
