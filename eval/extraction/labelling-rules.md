# Labelling rules for the extraction evaluation set

Each file in `postings/` is one real posting, collected on 2026-10-12 with a single read-only request
to a public job board (Greenhouse, Lever, Ashby, Recruitee, Teamtailor, SmartRecruiters) or dev.bg.
`input` is exactly what the engine sends the extractor (title, company, listed location, and the
posting HTML turned into text by `htmlToText`). `expected` is what a careful human reader finds in
that input. The scorer (`packages/core/src/evaluation/score.ts`) compares the extractor's facts to it.

Follow these rules so labels added later stay consistent with the existing ones. When a posting
needs a judgement call, write it in the file's `notes`.

## What to read

- Label only what the `input` says: the text plus the title and listed location. Nothing from the
  company's reputation, the board's own flags, or other postings. If a board marks a job "hybrid"
  but the extractor's input doesn't say so, it is not stated.
- Company descriptions, duties ("what you'll do"), benefits, hiring steps (CV, portfolio link,
  motivation letter, "CV in English", background checks, interviews) and the company's own
  certifications (ISO 27001 for the company) are not asks of the candidate.

## Requirements

- One entry per bullet (or sentence ask) under a heading that lists what the candidate needs
  ("Requirements", "You have", "Must have", "What we're looking for", "Изисквания",
  "Търсим човек, който", "Предимства", ...). Label every bullet under such a heading, even soft
  skills and odd ones; leave a bullet out only when it is plainly a duty that slipped under the
  heading (say so in `notes`).
- Don't split a bullet that lists alternatives or several tools ("Photoshop, Canva, Figma" is one
  requirement). Split it only when its parts differ in kind ("English is mandatory, German is an
  advantage" becomes a required English entry and a preferred German entry).
- `text` is a short English label (3 to 12 words) that keeps the posting's distinctive words: tool
  names, the subject of the experience, the number of years. Translate Bulgarian.
- Asks stated outside a requirements list count too when they are clearly asks of the candidate:
  right to work, a required working language ("Our company language is English"), willingness to
  travel.
- `kind` is `preferred` when the heading or wording says so: "Nice to have", "Bonus", "Plus",
  "Advantage", "Preferred", "Ideally", "highly desirable", "would make you stand out",
  "Предимства", "ще се счита за предимство", "Вашите предимства ще бъдат". Everything else under a
  requirements heading is `required`, including headings like "You'll be great for this role if"
  and "The perfect candidate has". A "preferred" word inside a required bullet ("GCP preferred")
  doesn't change the bullet's kind.

## Years

- One entry per stated number of years of experience, even when several asks give the same number.
  The same asks also appear in `requirements` (the extractor is told to repeat them).
- "3+ years", "at least 3", "minimum 3", "over 3", "3 years": `min: 3, max: null`.
  "3-5 years" / "3–5": `min: 3, max: 5`. One bullet with two numbers ("5 years in IT, 3 of them in
  security") gives two entries. Different numbers per level ("3+ for senior, 2+ for mid") give
  one entry per level.
- `about` is for the reader only; the scorer matches years on the numbers.

## Languages

- Spoken languages the candidate is asked for, with the English name ("English", "German"). A
  posting being written in English is not an ask. Programming languages are not languages.
- "English and/or German" or "English or German": either is enough, so each is `preferred`.
- `level` is for the reader only ("fluent", "B2", "good"); the scorer matches on the language.

## Certificates

- Only named credentials: CISSP, OSCP, CompTIA Security+, "MongoDB Certified DBA or Developer",
  a driving licence category B. One entry per named certificate ("CISSP, CISM or CEH" is three
  preferred entries). "Relevant certifications" with no name, degrees, and knowledge of a standard
  (ISO 27001, PCI DSS) are not certificates.

## Work authorisation (visaSponsorship)

- `offered` when the posting says it sponsors visas (even only for one country; note it).
- `not-offered` when it says it doesn't sponsor, or requires an existing right to work in the
  country ("must have the right to work in the UK").
- Otherwise `not-stated`. Relocation help alone is not visa sponsorship.

## Remote rule and locations

- `mode` from what the input states, including the listed location ("Sofia · Hybrid",
  "Fully Remote") and tags such as "#LI-Hybrid":
  - `remote`: fully remote / work from anywhere in a region.
  - `hybrid`: some days in an office, "hybrid", "remote supported with regular in-person days",
    "option to work remotely or hybrid" offered as a work model.
  - `on-site`: says on site / office-based / "office-first", or the work itself happens in a place
    (service base and clients' sites, a datacenter, commissioning robots in plants).
  - `not-stated` otherwise. Flexible hours, an office address or a commute allowance alone are
    not a remote rule.
- `locations`: the places the job is tied to or open to, in English, most specific form, one entry
  each ("Sofia", "Plovdiv"; for remote roles the countries or regions it is open to). Don't add the
  country next to its city. Include them whatever the mode (a "not-stated" job in Sofia still has
  `["Sofia"]`). A fully remote job open to no named place has `[]`.

## Salary

- Only pay stated in the text (the extractor doesn't see the board's structured salary fields).
  "Competitive", "motivating", "based on experience", bonuses, food vouchers and other benefits
  are not a salary: `salary: null`.
- Amounts as plain numbers (5.5k = 5500). `currency` is the ISO code only when the text states it
  or its symbol. `period` and `basis` (gross/net) only when stated: "annual base salary" gives
  `year`; a bare "base salary range $X–$Y" gives `period: null`, `basis: "not-stated"`. One amount
  is `min` with `max: null`.
- Several ranges (per country or level): label the first one stated and say so in `notes`.

## Posting language

- `language` is the ISO 639-1 code of the posting body: `bg` when it is written in Bulgarian
  (even with an English title), `en` otherwise.

## Privacy

- Store only posting text and metadata. Recruiters' names, emails and phone numbers are removed
  from the text (replaced by "[email removed]" / "[phone removed]"); no applicant data, ever.
