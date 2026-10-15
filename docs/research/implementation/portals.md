# Application portals: how they're built, and what filling them needs

Research for the Apply feature (JTBD 2 in [PRODUCT.md](../../design/PRODUCT.md)), 2026-10-13. Read-only: drawn from the portals' public documentation, public career pages as generally known, the old project's notes ([job-discovery.md §8](../../knowledge/job-discovery.md), [archive-reuse.md §6](archive-reuse.md)) and general knowledge of Chrome extensions. **Nothing here was checked against a live portal in this session**, and no account was created anywhere. Treat every selector as a starting hypothesis. The synthetic fixtures built from these notes have to be refreshed from real pages during the portal trial (Apply ticket "Portal trial"), using the field reports the extension saves with values stripped.

Companion: [ats-apis.md](ats-apis.md) covers the same vendors' public *job feed* APIs (Discover). This file covers their *application forms*.

## 1. Cross-cutting facts

### What a filler has to cope with

| Problem | Where | What works |
|---|---|---|
| React/Vue/Angular controlled inputs ignore `el.value = x` | Greenhouse (new boards), Lever, Ashby, Workable, Workday, SmartRecruiters | Call the **native value setter** from `HTMLInputElement.prototype` / `HTMLTextAreaElement.prototype`, then dispatch `input` and `change` (bubbling). Ported idea: `setNativeValue` in the old autofill extension. Works from Chrome's isolated world because the DOM and its events are shared |
| Custom dropdowns (no `<select>`) | Workday (`button` + listbox popup), Greenhouse new boards (react-select), Ashby, SmartRecruiters | Open the widget, pick the option whose text matches, verify the widget shows it. This needs clicks *inside the form control*, never on navigation |
| Typeahead fields that only accept a picked suggestion | Workday location / school / "How did you hear", Ashby location, Greenhouse new boards location | Type the text, wait for the listbox (bounded, ~2 s), pick the exact or best option, verify. If nothing fits, leave it as needs-you |
| File inputs | everywhere | Build a `File` from the PDF bytes, put it in a `DataTransfer`, assign `input.files = dt.files`, dispatch `change`. Some drop zones listen for `drop` instead; the filler tries `change` first and `drop` second, then verifies that the portal shows the file name |
| Values that "don't stick" | Workday phone (reformats as typed), masked date inputs | Verify after a short settle; never loop. Report "didn't stick" with a copyable value in the field's own format |
| Repeating sections (work history, education) | Workday "Add", Greenhouse education (classic boards), SmartRecruiters | Click the section's own "Add" control as part of filling that section; never more entries than the profile has |
| Shadow DOM | SmartRecruiters (`spl-*` web components), some Workable widgets | Walk open shadow roots when reading and filling. Closed roots can't be read; their fields go to the copy list |
| Cross-origin iframes | Greenhouse embed (`#grnhse_app` → `boards.greenhouse.io/embed/job_app`), Lever and Ashby embeds on company sites | `activeTab` doesn't reach a frame on another origin. Either the user opens the form on its own (the frame's `src` is a normal page) or the ATS host is in the extension's granted hosts and the filler is injected with `allFrames` |
| Portal's own CV parsing | Workday ("Autofill with Resume"), Lever, Ashby, Workable, SmartRecruiters | Parsing runs when the CV is attached and can overwrite or add fields. Attach the CV **first**, let it settle, then fill, and never overwrite a non-empty field silently (report it as "already had a value") |
| Bot protection | Greenhouse new boards (reCAPTCHA Enterprise), Lever (hCaptcha on submit), SmartRecruiters, Workday tenants behind Akamai/Cloudflare | Nothing to do and nothing to try: apply-kit never submits, so it never meets the challenge. A visible challenge is the user's to solve |

### Chrome mechanics (MV3)

- **`activeTab`** grants temporary host access to the tab's current origin when the user invokes the extension: clicking the toolbar action, a `commands` keyboard shortcut, a context-menu item. The grant is dropped when the tab navigates to another document. **Same-document navigation** (SPA route changes via `pushState`, which is how Workday, Ashby and Workable move between steps) generally keeps it; a full page load does not. Unknown and to verify in the first Apply ticket: whether opening the **side panel** from the toolbar (`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`) carries the same grant, and whether a click on a button *inside* the side panel counts as an invocation (assume it doesn't).
- **Optional host permissions** (`optional_host_permissions` + `permissions.request()` from a user click) give lasting access to named hosts after one Chrome prompt. This is how the six ATS hosts are reached across page loads and inside embedded frames (ADR 0005).
- **No declared content scripts**: the filler is injected with `scripting.executeScript` only when the user clicks a fill button, so nothing of apply-kit runs on a portal by itself. The injected script lives in the isolated world for that document; a second injection into the same document finds it already there.
- **`executeScript` arguments must be JSON-serialisable**: the CV PDF travels as base64 (a one-page CV is ~100–200 KB, fine).
- **Content-script fetches** are subject to the page's origin rules, so the in-page filler never talks to the local service. The side panel does all service calls and hands the filler only the answers for the fields on the page.
- **Password generation**: Chrome's password manager offers "Use strong password" when the user focuses a field it classifies as a new password. `autocomplete="new-password"` on the password and confirm fields makes that classification reliable; right-click → "Suggest strong password" is the manual fallback. Programmatic `focus()` from an extension does not reliably trigger the offer, so the user clicks the field.

### Label reading (ported, from `autofill-extension/src/content/fieldContext.ts`)

`label[for=id]` → wrapping `<label>` → `aria-labelledby` → `aria-label` → `placeholder` → nearest legend/heading/`.question` within 5 ancestors → humanised `name` → "Unlabeled field". Skip `password`, `hidden`, `submit`, `search` inputs. Normalise questions Unicode-safely (`\p{L}\p{N}`), never with `\b` around Cyrillic. Per-portal fillers override this with stable attributes where the portal has them (below); the chain is the generic fallback.

## 2. Per portal

### Workday

- **URLs:** `<tenant>.wd<N>.myworkdayjobs.com/<locale>/<site>/job/<location>/<title>_<REQ-ID>` and `/apply`, `/apply/applyManually`, `/apply/autofillWithResume`; also `<tenant>.wd<N>.myworkdaysite.com/recruiting/...`. Job id is the `_R-12345`-style suffix (tenant-specific format, e.g. `JR0001234`).
- **Shape:** a single-page app with a **stepper** (typically: My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review). Step names and count are printed on the page, and the tenant configures them. Steps change without a full page load.
- **Account:** required, **per tenant** (an account at one company's Workday does not work at another's). "Create Account" asks for email, password, verify password and usually a terms checkbox; some tenants send a verification email before the application continues. Sign-in uses the same email.
- **Start choice:** "Autofill with Resume" / "Apply Manually" / "Use My Last Application". Workday's parsing commonly duplicates work-history entries with wrong dates, so apply-kit suggests **Apply Manually** and attaches the CV on My Experience.
- **Fields:** stable `data-automation-id` attributes, e.g. `legalNameSection_firstName`, `legalNameSection_lastName`, `email`, `phone-number`, `phone-device-type`, `countryPhoneCode`, `addressSection_city`, `addressSection_countryRegion`, `sourceDropdown` / "How did you hear about us?" (`formField-source`), `previousWorker` (radio), work experience `jobTitle`, `company`, `location`, `currentlyWorkHere`, `dateSectionMonth-input` / `dateSectionYear-input`, `description`; education `school` (typeahead), `degree` (dropdown), `fieldOfStudy` (typeahead); `file-upload-input-ref` for the CV; `linkedinQuestion`, `websitePanelSection`. Questions on Application Questions render as `formField-<id>` with the question text in a label; yes/no are dropdowns.
- **Widgets:** dropdowns are `button[aria-haspopup="listbox"]` opening a popup list; multi-select typeaheads ("How did you hear", skills) need type → choose. Dates are split month/year text inputs with masks.
- **Navigation buttons to never press:** `bottom-navigation-next-button` ("Save and Continue" / "Next"), `bottom-navigation-previous-button`, "Submit", "Apply", "Sign In", "Create Account".
- **Confirmation:** an "Application Submitted" / "Thank you for applying" view; the candidate home lists the application.
- **Risk:** the most-hated, most-common portal and moment of truth 3 in [flows.md](../../design/flows.md). Tenants customise questions heavily. Fill one step per click.

### Greenhouse

- **URLs:** classic `boards.greenhouse.io/<board>/jobs/<id>`, new `job-boards.greenhouse.io/<board>/jobs/<id>` (and `job-boards.eu.greenhouse.io`), embeds on company sites via `#grnhse_app` iframe pointing to `boards.greenhouse.io/embed/job_app?for=<board>&token=<id>`; company pages often carry `?gh_jid=<id>`. Job id = the numeric id (same as the Job Board API's `id`, so it matches the Discover posting directly).
- **Shape:** one page: the posting with the application form under it. No account.
- **Fields (classic):** `#first_name`, `#last_name`, `#email`, `#phone`, `#resume` (file, inside "Attach"; also Dropbox/Google Drive/"Enter manually"), `#cover_letter` (file or paste), `#job_application_location`, LinkedIn/website as custom questions, `job_application[answers_attributes][N][text_value]` / `[boolean_value]` / select for custom questions (question text in the label), education blocks with select2, EEOC selects `#job_application_gender`, `#job_application_race`, `#job_application_veteran_status`, `#job_application_disability_status` (US jobs only).
- **Fields (new boards):** `#first_name`, `#last_name`, `#email`, `#phone`, `#country` (react-select), `#resume` file input, `#cover_letter`, custom questions as `#question_<id>` with react-select for choices, demographic questions in a separate voluntary section.
- **Navigation to never press:** "Submit application" / "Submit".
- **Confirmation:** `/confirmation` or an inline "Thank you for applying" message.
- **Bonus:** the Job Board API (`?questions=true`) lists a job's custom questions, so Prepare can draft screening answers before the portal is opened (see ats-apis.md).

### Lever

- **URLs:** `jobs.lever.co/<company>/<posting-uuid>` and `/apply`; `jobs.eu.lever.co` for EU-hosted companies. Job id = the posting UUID (matches Lever's postings API `id`).
- **Shape:** one page, no account.
- **Fields:** `input[name="name"]` (**one full-name field**), `email`, `phone`, `location` (with a typeahead on some boards), `org` (current company), `urls[LinkedIn]`, `urls[GitHub]`, `urls[Portfolio]`, `urls[Twitter]`, `urls[Other]`; `#resume-upload-input` (file; Lever parses it and may pre-fill name, email, phone, company); `comments` ("Additional information", a textarea used as the cover letter); custom questions `cards[<uuid>][field<N>]` (text, textarea, radio, checkbox, select); EEO `eeo[gender]`, `eeo[race]`, `eeo[veteran]` (US).
- **Navigation to never press:** "Submit application". hCaptcha may appear on submit.
- **Confirmation:** `/thanks` page ("Application submitted").

### SmartRecruiters

- **URLs:** posting `jobs.smartrecruiters.com/<Company>/<job-id>-<slug>`; application in the "OneClick" app at `jobs.smartrecruiters.com/oneclick-ui/company/<Company>/publication/<publication-uuid>`. Job id = the numeric id in the posting URL (matches the Posting API's `id`); the publication uuid is carried in the apply URL.
- **Shape:** one long page with sections (personal info, experience, education, "Your message to the hiring manager", screening questions), sometimes a second "questions" step. No account needed; "Apply with LinkedIn/Indeed" options exist and are left alone.
- **Fields:** web components (`spl-input`, `spl-select`, `spl-autocomplete`, `spl-checkbox`) with **open shadow roots**; the real `<input>` lives inside. Attributes such as `id="first-name-input"`, `last-name-input`, `email-input`, `confirm-email-input`, `phone-number-input`, `linkedin-input`, a location autocomplete, and a CV drop zone with a hidden file input. Experience and education are repeatable entries opened with an "Add" control.
- **Navigation to never press:** "Next", "Submit", "Apply".
- **Confirmation:** a "Thank you" / "Your application has been submitted" view.
- **Risk:** shadow DOM means generic label reading fails; the filler must read through `shadowRoot`.

### Workable

- **URLs:** `apply.workable.com/<account>/j/<shortcode>/` and `/apply/`; also company-hosted widgets. Job id = the shortcode (matches Workable's public widget/jobs API).
- **Shape:** one page (some accounts split into "Application" and "Questions"), no account.
- **Fields:** React form with `name`/`data-ui` attributes: `firstname`, `lastname`, `email`, `headline`, `phone` (with a country picker), `address`, `avatar` (photo, optional), `resume` (file; parsed), `cover_letter` (textarea), `summary`, education and experience repeaters with "+ Add", custom questions `QA_<id>` (text, yes/no as radio, multiple choice, date, file). Some fields are marked "Optional" in text rather than `required`.
- **Navigation to never press:** "Submit application".
- **Confirmation:** "Application submitted" / thank-you view.

### Ashby

- **URLs:** `jobs.ashbyhq.com/<company>/<job-uuid>` and `/application`; embeds via `jobs.ashbyhq.com/<company>/embed`. Job id = the UUID (matches the posting API's `id`).
- **Shape:** one page (Overview / Application tabs), no account.
- **Fields:** system fields with stable ids: `#_systemfield_name` (full name), `#_systemfield_email`, `#_systemfield_phone`, `#_systemfield_location` (typeahead), `_systemfield_resume` (file input; Ashby offers "Autofill from resume", which the filler doesn't press), `_systemfield_linkedin` / custom URL fields; custom questions keyed by UUID, yes/no rendered as **two buttons** (an in-form control: choosing one is filling, not navigating), multi-select checkboxes, date pickers. Demographic survey in a separate optional block.
- **Navigation to never press:** "Submit Application".
- **Confirmation:** inline "Thanks for applying" / "Application submitted" message on the same page.

### Not targeted (generic fallback only)

SuccessFactors, Taleo, iCIMS, Personio, Teamtailor, Recruitee, BambooHR, company-built forms (common with Bulgarian employers, often in Bulgarian). The generic fallback fills nothing by default: it shows the package and profile values as a copy list in the form's order, and offers an opt-in "fill fields whose label I'm sure about" that marks every field it touched. Personio, Recruitee and Teamtailor are simple single-page forms and good candidates to promote to real fillers after the portal trial.

## 3. Detecting the page kind

A filler classifies the page it reads into one of:

| Kind | Signals |
|---|---|
| `form` | visible fillable fields the filler recognises (at least 2), not a password-only page |
| `account` | a new-password field plus a confirm-password field, or the portal's "Create Account" view (Workday `createAccountSubmitButton`) |
| `sign-in` | one current-password field and an email field |
| `review` | Workday's Review step; other portals have none |
| `confirmation` | the portal's thank-you view (URL `/thanks`, `/confirmation`, or the portal's confirmation text) |
| `posting` | the job description with an "Apply" button and no form yet |
| `other` | anything else |

The confirmation signal is only a hint: the user confirms with "Mark as submitted".

## 4. Matching the page to a Package

Every filler extracts a **portal job reference** `{ ats, board/tenant, jobId }` from the URL (and, for embeds, from the frame `src` or `gh_jid`). The Package's **target posting** carries the same reference when it came from that ATS's feed, so the match is exact. Fallbacks, in order: the same company with one approved, unsubmitted package (shown as "Is this the right package?"); several candidates (the user picks); none (no-package state). Title similarity alone never selects a package silently.

## 5. Open questions to settle in the first tickets

1. Does the side panel opened from the toolbar get `activeTab` on the current tab? (Decides whether the generic fallback works without the keyboard shortcut.) **Answered in ADR 0005** (ticket #37): not when opened with `openPanelOnActionClick`; yes when the extension opens it from `action.onClicked`, which is what apply-kit does.
2. Does `activeTab` survive Workday's step changes on every tenant (same-document) and the account-creation redirect? Partly answered in ADR 0005: it survives same-document steps and full loads on the same site, and is dropped on a load on another site; the real tenants are for the portal trial.
3. Which Workday tenants used by Sofia employers (Bosch, A1, Kestrel-like banks) require email verification before the application?
4. Does Greenhouse's new board accept a `DataTransfer` file on `#resume` without a drop event?
