# Models and career-site access (researched 2026-10-11)

Prices and terms change; re-check before relying on them. Sources were official pricing pages, docs and robots.txt files read on 2026-10-11.

## LLMs for apply-kit

Assumed volume: ~300 job postings/day extracted (≈9k/month), ~15 tailored CVs and ~15 cover letters/week.

| Model | $/1M in / out | Est. monthly | Notes |
|---|---|---|---|
| Claude Haiku 5.5 (`claude-haiku-5-5`) | 0.10 / 0.50 (batch 0.05 / 0.25) | extraction ≈ $1.6 batched | Strict structured outputs; API data not used for training by default |
| GPT-6 Luna (mini) | 0.10 / 0.50 (batch half) | extraction ≈ $1.6 batched | Structured outputs |
| DeepSeek V4.1 Flash | 0.15 / 0.60 off-peak, 0.30 / 1.20 peak | extraction $4–9 | Good value. **First-party API stores data in China and may train on it**: never send the CV/personal data there |
| GLM-5.3 Flash | 0.15 / 0.50 (batch 0.06 / 0.20) | extraction ≈ $1.6 batched | China-hosted first party |
| Mistral Small / Large | 0.15 / 0.60; 0.50–0.68 / 1.50–2.09 | writing < $1 | EU-hosted (GDPR-friendly) |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2 / 10 (batch 1 / 5) | writing ≈ $4–6 | Best reputation for natural prose and obeying "don't fabricate" |

Claude 4.7+ tokenizer counts ~30% more tokens; prompt caching cuts input cost further. No current writing-quality benchmark could be fetched: validate writers with blind A/B samples.

**Recommendation:** extraction on Haiku 5.5 (batch) or DeepSeek Flash (postings hold no personal data); CV tailoring, cover letters and screening answers on Sonnet 5.5 (Mistral Large as the cheap EU fallback). Total ≈ $6–10/month. Personal data only goes to providers that don't train on API data.

## Career sites: how to read them legally

| Source | Route | Status |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{co}/jobs` | Official public API |
| Lever | `api.lever.co/v0/postings/{co}?mode=json` (EU: `api.eu.lever.co`) | Official public API (crawl-delay 1s) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}` | Official public API |
| Recruitee | `{co}.recruitee.com/api/offers/` | Official public API |
| Personio | `{co}.jobs.personio.de/xml` | Official public feed |
| Teamtailor | `{co}.teamtailor.com/jobs.rss` | Official RSS |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` | Works without key today; docs say key/OAuth |
| Workday | `POST /wday/cxs/{tenant}/{site}/jobs` | Public JSON, grey area, often bot-protected |
| Workable | widget/API on `apply.workable.com` | Robots allows; endpoint unconfirmed |
| Microsoft | `apply.careers.microsoft.com/api/pcsx/search` | Public JSON, robots explicitly allows |
| Amazon | `amazon.jobs/en/search.json` | Public JSON, robots allows |
| Google | — | **Disallowed** (robots + ToS) → use Google's email job alerts |
| Apple | — | **Disallowed** (ToS bans robots) → saved searches/alerts |
| Meta | jobs sitemap only | **Disallowed** otherwise → email job alerts |

Pattern: official ATS endpoints first (clean JSON, cheap), polite low-frequency polling of Microsoft/Amazon, and **email job alerts as the push route** for Google, Apple, Meta, LinkedIn and jobs.bg.
