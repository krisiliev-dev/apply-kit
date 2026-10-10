# Company watchlist (draft): Sofia / EU-remote CS roles

**Date:** 2026-10-11 · **Target:** full-stack/software engineering (dev), cybersecurity (sec), product/UX design (design); on-site/hybrid in Sofia or remote in European time zones.

**Method.**
1. Built the candidate list from the brief, my own knowledge of the Sofia market, and web searches (company careers pages, dev.bg, Built In, aggregators).
2. For each company I looked for its ATS in three ways: fetched the careers page and grepped it for ATS hosts, guessed likely slugs and probed the public job-board APIs, and ran web searches.
3. Every probe was a single read-only request. Greenhouse, Lever, Ashby, Recruitee, Teamtailor RSS, Personio XML, Workable widget and SmartRecruiters were plain GETs. Workday has no GET listing endpoint, so I sent one read-only search POST to its public `wday/cxs/{tenant}/{site}/jobs` endpoint per tenant (searchText "Sofia").
4. "Verified = yes" means the endpoint answered with a valid board on 2026-10-11. **"N total / M BG"** is the number of open postings, then how many of them have Sofia/Bulgaria in the location field. Counts are snapshots.
5. "Own site" means no public ATS API was found, so you would need to scrape the page or set up email alerts.

Feed URL patterns:
- Greenhouse (GH): `boards-api.greenhouse.io/v1/boards/{token}/jobs`. This also serves EU-hosted `job-boards.eu.greenhouse.io` boards.
- Lever: `api.lever.co/v0/postings/{slug}?mode=json`
- Ashby: `api.ashbyhq.com/posting-api/job-board/{name}`
- Recruitee: `{slug}.recruitee.com/api/offers/`, or `{custom-domain}/api/offers/`
- Teamtailor (TT): `{slug}.teamtailor.com/jobs.rss`
- SmartRecruiters (SR): `api.smartrecruiters.com/v1/companies/{id}/postings?country=bg`
- Workable: `apply.workable.com/api/v1/widget/accounts/{slug}`

| Company | Group | Fields relevant | ATS | Feed identifier (token/slug/URL) | Verified? | Notes |
|---|---|---|---|---|---|---|
| SAP Labs Bulgaria | A | dev, sec, design | SuccessFactors (own site) | https://jobs.sap.com/go/Bulgaria/8806301 | no | Biggest Sofia R&D employer; many Sofia dev/SRE roles appear in search. The site sits behind a Cloudflare challenge, so scripted GET/RSS is blocked: use the site's job alerts. |
| Broadcom (ex-VMware) | A | dev, sec | Workday | broadcom.wd1.myworkdayjobs.com/External_Career | yes (385 total / 0 Sofia today) | Tenant works but no Sofia postings right now; Glassdoor shows 2026 Sofia interviews. Keep it as a low-frequency watch. |
| Uber | A | dev, sec | Own site | https://www.uber.com/careers/locations/sofia | no | Sofia engineering site since 2014 (tax/compliance, fintech systems). The careers search is an internal POST API, so no public feed. |
| Experian | A | dev, sec, design | SmartRecruiters | `Experian` | yes (393 total / 28 BG) | Strong Sofia hub; use `?country=bg`. |
| Bosch | A | dev | SmartRecruiters | `BoschGroup` | yes (4933 total / 5 BG) | Filter with `?country=bg`. |
| Playtech | A | dev, design | SmartRecruiters | `Playtech` | yes (122 total / 33 BG) | Large Sofia gaming-tech centre. |
| Ubisoft Sofia | A | dev, design | SmartRecruiters | `Ubisoft2` | yes (339 total / 3 BG) | The ID really is `Ubisoft2` (`Ubisoft` is empty). |
| Gameloft Sofia | A | dev, design | SmartRecruiters | `Gameloft` | yes (53 total / 2 BG) | |
| DXC Technology | A | dev, sec | Workday | dxctechnology.wd1.myworkdayjobs.com/DXCJobs | yes (33 Sofia hits) | Locations read "BGR - SOFIA". |
| Hewlett Packard Enterprise | A | dev, sec | Workday | hpe.wd5.myworkdayjobs.com/Jobsathpe | yes (17 Sofia hits) | |
| Mastercard | A | dev, sec | Workday | mastercard.wd1.myworkdayjobs.com/CorporateCareers | yes (3 Sofia hits) | |
| Visa | A | dev, sec | Workday | visa.wd5.myworkdayjobs.com/Visa | yes (1 Sofia hit) | Small Sofia footprint. |
| Progress (Telerik) | A | dev, design | Jobvite | https://jobs.jobvite.com/progress | no | Several hybrid Sofia roles show in search (DevOps, PM, design engineer). Jobvite's JSON API needs a key, so scrape the HTML board. |
| Paysafe | A | dev, sec | Own site (likely SuccessFactors) | https://jobs.paysafe.com | no | Sofia roles exist (hybrid, 3 days in the office). The RSS endpoint returned nothing. |
| Endava | A | dev, design | SmartRecruiters | `Endava` | yes (120 total / 0 BG today) | Sofia presence confirmed by 2026 listings; BG roles may surface intermittently. |
| Ocado Technology | A | dev, design | Greenhouse | `ocadogroup` | yes (49 total / 5 BG) | Sofia development centre; the careers site wraps GH (`gh_jid`). |
| Tide | A | dev, sec, design | Greenhouse | `tide` | yes (91 total / 19 BG) | Big Sofia hub. |
| SumUp | A | dev, sec, design | Greenhouse | `sumup` | yes (346 total / 34 BG) | Sofia engineering hub. |
| Workato | A | dev | Greenhouse | `workato` | yes (73 total / 3 BG) | Sofia engineering office. |
| Insurify | A | dev | Greenhouse | `insurify` | yes (15 total / 6 BG) | Sofia backend/frontend/cloud roles. |
| Appfire | A | dev | Greenhouse | `appfire` | yes (18 total / 4 BG) | |
| Coherent Solutions | A | dev | Greenhouse | `coherentsolutions` | yes (17 total / 4 BG) | |
| Dext | A | dev | Ashby | `Dext-Careers` | yes (6 total / 1 BG) | Location label "Dext Bulgaria"; the dev team is mostly remote within BG. |
| Avenga (ex-Musala Soft) | A | dev, design | Teamtailor | `avenga` | yes (100 RSS items, ~22 mention Sofia) | musala.com now redirects to Avenga careers. |
| Nortal (ex-Questers) | A | dev | Greenhouse | `nortal` | yes (25 total / 0 BG today) | questers.com redirects to Nortal careers. |
| UKG | A | dev, design | Own site | https://www.ukg.com/company/careers (apply.ukg.com) | no | "Global Innovation Hub" in Sofia and Varna; Sofia .NET roles are hybrid. |
| Skyscanner | A | dev, design | Own site | https://www.skyscanner.net/jobs/sofia | no | Sofia engineering hub; no ATS marker in the HTML (JS-rendered). |
| HedgeServ | A | dev | Own site | https://www.hedgeserv.com | no | Sofia tech office (Python/Angular, QA); also posts on dev.bg. |
| Creative Assembly (SEGA) Sofia | A | dev, design | Own site | https://www.creative-assembly.com/careers | no | Total War studio; UI/UX and gameplay roles. The site rate-limited (429) the fetch. |
| Coca-Cola HBC (Sofia IT hub) | A | dev, sec | SuccessFactors (own site) | https://www.coca-colahellenic.com/en/careers | no | Business Services Organisation in Sofia; RSS is not reachable. |
| EPAM Bulgaria | A | dev | Own site | https://www.epam.com/careers | no | No public feed. |
| Scalefocus | A | dev | Own site | https://www.scalefocus.com/careers | no | A Workable account `scalefocus` exists but has 0 jobs, so it is likely unused. |
| IBM Bulgaria | A | dev, sec | Own site | https://www.ibm.com/careers | no | Large Sofia presence; site-specific search only. |
| Accenture Bulgaria | A | dev, sec, design | Own site | https://www.accenture.com/bg-en/careers | no | Large Sofia presence. |
| Proxiad | A | dev | Own site | https://www.proxiad.com | no | Sofia presence not re-verified for 2026. |
| Chaos | B | dev, design | Recruitee | `chaos` | yes (16 total / 5 BG) | V-Ray/Corona maker; Sofia HQ. |
| Payhawk | B | dev, sec, design | Greenhouse | `payhawkio` | yes (44 total / 12 BG) | EU-hosted board, but the standard API works. Includes design roles (e.g. Senior Digital Experience Designer). |
| Trading 212 | B | dev, sec, design | Ashby | `trading212` | yes (65 total / 22 BG) | |
| Crypto.com (Sofia) | B | dev, sec | Lever | `crypto` | yes (84 total / 5 BG) | BG roles include Security IT Support Engineer and Senior Manager, Identity Governance. |
| myPOS | B | dev, sec | Teamtailor | `mypos` | yes (78 RSS items, ~52 mention Sofia) | Sofia fintech HQ. |
| TBI Bank | B | dev, sec | Recruitee | `tbibank` | yes (51 total / 51 BG) | |
| SiteGround | B | dev, sec | Lever | `siteground` | yes (5 total / 5 BG) | Sofia HQ hosting company. |
| Delasport | B | dev | Greenhouse | `delasportbulgaria` | yes (9 total / 9 BG) | Sofia and Plovdiv. |
| Accedia | B | dev | Recruitee | `accedia` | yes (5 total / 5 BG) | |
| Strypes | B | dev | Recruitee | `strypes` | yes (1 total / 0 BG) | Low volume. |
| SuperHosting.BG | B | dev, sec | Teamtailor | `superhosting` | yes (1 item, Sofia) | Low volume. |
| WorkBoard (ex-Quantive/Gtmhub) | B | dev | Greenhouse | `workboard` | yes (4 total / 1 BG) | Quantive was acquired by WorkBoard; its Sofia engineering continues. |
| Nexo | B | dev, sec, design | Own site | https://nexo.com (careers) | no | Many Sofia roles appear on aggregators; no ATS host found (nexo.com/careers returned 404). |
| Shelly Group | B | dev, design | HiBob | https://shellygroup.careers.hibob.com/jobs | no | HiBob's job-ad API returns 401, so scrape the page or set up alerts. Firmware/full-stack roles at the Sofia HQ. |
| EGT Digital / Amusnet | B | dev, sec | Own site | https://egt-digital.com/careers/ | no | Java and observability roles appear on bulgariawantsyou.com. |
| Yettel Bulgaria | B | dev, sec | SuccessFactors | https://jobs.ceetelcogroup.com/ | no | Linked from yettel.bg. |
| A1 Bulgaria | B | dev, sec | Own site | https://jobs.a1.com/bg/ | no | |
| Vivacom | B | dev, sec | Own site | https://www.vivacom.bg/bg/kariera | no | |
| DSK Bank | B | dev, sec | Own site | https://dskbank.bg (Кариери) | no | |
| UBB | B | dev, sec | Own site | https://www.ubb.bg | no | The careers page returned 403 to scripted fetches. |
| Sirma Group | B | dev, sec | Own site | https://careers.sirma.com | no | |
| Bianor | B | dev | Own site | https://www.bianor.com | no | |
| Infragistics | B | dev, design | Own site | https://www.infragistics.com/about-us/careers | no | Sofia R&D. |
| Dreamix | B | dev | Workable | `dreamix` | no (account exists, 0 jobs) | |
| Imagga | B | dev | Workable | `imagga` | no (account exists, 0 jobs) | |
| Dronamics | C | dev | Recruitee (custom domain) | https://careers.dronamics.com/api/offers/ | yes (16 total, Sofia) | Mostly aerospace/systems roles; few pure software roles. |
| AMPECO | C | dev, design | Lever | `ampeco-global` | yes (11 total / 7 BG) | EV-charging SaaS scale-up. |
| EnduroSat | C | dev | Own site | https://www.endurosat.com/careers/ | no | Search lists Sofia Java, front-end, JS and embedded roles. |
| Hyperscience | C | dev | Ashby | `hyperscience` | yes (1 total / 0 BG) | Has a Sofia office; currently quiet. |
| Enhancv | C | dev, design | Own site (Typeform) | https://enhancv.com/careers/ | no | "No open positions" right now. |
| Canonical | Remote | dev, sec | Greenhouse | `canonical` | yes (311 total) | Remote-first, hires globally incl. BG. |
| GitLab | Remote | dev, sec, design | Greenhouse | `gitlab` | yes (221 total) | All-remote. |
| Grafana Labs | Remote | dev, sec | Greenhouse | `grafanalabs` | yes (106 total) | Remote EMEA roles. |
| Elastic | Remote | dev, sec | Greenhouse | `elastic` | yes (409 total) | Distributed; check country eligibility per post. |
| Kraken | Remote | dev, sec | Ashby | `kraken.com` | yes (82 total; ~30 list Bulgaria among eligible countries) | Crypto exchange with strong security hiring. |
| Smartsheet | Remote | dev | Greenhouse | `smartsheet` | yes (94 total / 4 BG) | BG-remote roles via an employer of record while it sets up a BG entity. |
| ClickHouse | Remote | dev | Ashby | `clickhouse` | yes (195 total) | Remote-friendly; check EU eligibility. |
| 1Password | Remote | dev, sec | Ashby | `1password` | yes (71 total) | Mostly NA/EU remote; check eligibility. |
| n8n | Remote | dev, design | Ashby | `n8n` | yes (38 total) | Berlin plus remote Europe. |
| Toptal | Remote | dev, design | Lever | `toptal` | yes (32 total) | Fully remote company. |

## Couldn't determine

- **No ATS found:** Nexo, Telelink Business Services, Businessmap (ex-Kanbanize), Fibank, Postbank, Paynetics, Borica, Phyre, Boleron, Healee, Melon, Kaufland Bulgaria IT. There was no ATS marker on the reachable pages and slug probes failed on GH/Lever/Ashby/Recruitee/Workable/TT/Personio/SR/BambooHR.
- **ATS behind JS/anti-bot:** SAP (Cloudflare), Skyscanner, HedgeServ, Uber, Creative Assembly (429), Paysafe, UKG.
- **Sofia presence not confirmed, left out of the table:**
  - Google: no Sofia engineering office found.
  - Microsoft: careers API not reachable; only a small sales presence is known.
  - Amazon: amazon.jobs returned 0 postings for country BGR.
- **Renamed or merged:** Musala Soft → Avenga; Questers → Nortal; Gtmhub/Quantive → WorkBoard; VMware → Broadcom (no Sofia postings today).
- **Stale Workable accounts (0 jobs):** scalefocus, dreamix, imagga, hedgeserv, siteground, fourth, tinqin, enhancv, chaos, nexo. These may be different companies or abandoned boards, so don't rely on them.
- **Not yet researched, worth a second pass:** startup portfolios (Eleven Ventures, LAUNCHub, BrightCap) and the Sofia Tech Park tenant list. Group C is thin here (5 rows).
