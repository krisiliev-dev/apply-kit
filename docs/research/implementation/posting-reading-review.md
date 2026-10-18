# Posting reading and junior-first ranking review

## Scope and baseline

Baseline a88a690. Targeted review of missing posting descriptions, disabled preparation, requirement/experience ranking, reading queue priority and budget usage. Includes the new detail-fetch boundary, source-check retention, manual text input, explicit refresh and PDF startup loading. No personal profile contents, credentials or raw postings are included here. This is not an exhaustive audit.

## Root causes and changes

Workday and SmartRecruiters listing responses intentionally lack descriptions. The reader treated that absence as a permanent failure rather than obtaining the full posting. A live public Workday detail request returned a description, confirming the text existed at the source. Their adapters now expose deferred description reads. Other sources use the existing guarded page reader, retaining protected-site, robots, redirect, timeout and polite-fetch behavior. Description retrieval precedes the existing schema-validated AI extraction. Preparation continues to require a successful read; its guard was not weakened.

Source checks retain downloaded or supplied text when their response has no readable body. Existing descriptions and extracted facts remain cached; an explicit Refresh posting and requirements action retrieves changes. Missing descriptions can be pasted on the existing job page, escaped and saved before reading within the same budget. A concurrent fetch checks for supplied text before writing its result.

The old Fit was provisional for unread postings and weighted requirements at 35%. Ranking now puts senior-title/required-experience stretches after attainable roles, then compares assessed requirement coverage before the existing overall Fit. Known coverage leads metadata-only scores. Junior/entry title priority defaults on for older saved preferences and can be switched off in Search settings. Scores retain their existing breakdown; the Feed names the new ordering. Required experience shortfalls are distinct from optional preferences.

The automatic queue prioritises relevant locations and career angles, then junior/entry roles. Its summary query does not load full posting descriptions or resolve every nested target up front. The actual target is still selected normally for each read. Once the cap is exhausted, the background reader does not continue downloading detail pages. Budget tests intentionally now leave those jobs unscreened rather than attempting a no-text failure. The shared monthly cap and reservation logic were not changed.

A macOS process sample also showed native PDF/font initialisation during service startup. PDF support now loads only when PDF work is requested; the reader can be constructed while native PDF support is unavailable.

## Baseline invariants and blast radius

Git blame identifies extraction persistence in 30a85246 and text-specific fact-confirmation invalidation in 2b4d1a26. Text hashes, schema validation, accounting, provider routing and package readiness remain intact. About 20 direct references cover readJob/readPosting, ranking and detail fetching across the core, API and UI. A shared source-store update also affects imported and captured jobs; their regression suites were run.

## Independent adversarial review

The reviewer used fictional in-memory fixtures only and reported:

- Empty non-null markup could overwrite a manually supplied description despite COALESCE. A failing regression drove normalising unreadable incoming bodies to null before updating the stored description.
- Cached detail responses had no refresh path. A failing regression drove an explicit refresh option and UI action. Automatic TTL revalidation remains outside this change and is documented in the code.

No additional concrete defect was reported in adapter URL construction, protected-site checks, text request validation or lazy PDF loading. Workday detail URLs must match their configured origin and careers path; SmartRecruiters uses its fixed public API host and encoded identifiers. Pasted input requires JSON, a nonempty string and a 100,000-character limit. React displays text rather than interpreting supplied HTML. Existing local API protections remain in force.

## Verification

- Full suite: 109 files, 1,436 tests passed.
- TypeScript build, ESLint, Vite build and whitespace checks passed. The existing large-bundle advisory remains.
- Browser with fictional data: missing Workday text retrieved, requirements shown, preparation enabled after the asynchronous readiness response; manual pasted text read and preparation enabled; explicit refresh completed; 375px viewport had no horizontal page overflow.
- A full-suite capture regression and type errors introduced while threading the refresh parameter were corrected before the final passing run.
- Database backup completed before the live service update. No bulk paid reanalysis was launched and the monthly cap was not raised.

## Cost estimate and limitations

The configured model is DeepSeek V4.1 Flash. Current allowed-provider prices were checked against [OpenRouter's endpoint data](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints) on 2026-10-18. At 3,000 input and 2,000 output tokens, the observed low-to-high allowed prices imply about $0.001–$0.005 per job, $0.10–$0.50 per 100, or $3–$13 for 2,659 jobs. These are estimates, not a quote; long responses, longer prompts and retries can increase costs. The configured $10 monthly cap covers extraction and writing together. Profile matching and reranking use local confirmed evidence and require no second model call.

Some employers publish no salary; a successful read must say Not stated rather than invent one. Protected or unavailable postings may require user-supplied text. Differently worded skill evidence still uses the existing deterministic matching rules, not a new per-job AI assessment of the full profile. The remaining backlog is processed within the configured cap, prioritising relevant junior roles.

Live verification after restart: the initially failing Workday job returned reading=read, 5,240 characters of posting text, seven requirements, salary Not stated and prepare.canStart=true. The shared cap remained $10. Only aggregate/public-job diagnostic fields were emitted; no profile contents were read. Normal background reading continued.
