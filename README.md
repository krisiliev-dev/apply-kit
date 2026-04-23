# CV Maker

A personal CV workshop. Each CV variant is its own React component, so you have full creative freedom — typography, layout, composition.

## Project layout

```
app/
  page.tsx              index of all CV variants
  cv/<slug>/page.tsx    one file per CV — full design freedom lives here
  layout.tsx            root layout, font registration
  globals.css           Tailwind theme, A4 page, print CSS, grid overlay

components/
  cv/CvPage.tsx         A4 page wrapper (print sizing + grid overlay)
  cv/primitives.tsx     optional helpers (SectionHeading, Tag, etc.)
  dev/DevToolbar.tsx    grid toggle + print button (hidden when printing)

content/
  profile.ts            your stable identity (shared across variants)
  cvs/<slug>.ts         typed content per CV variant
  cvs/index.ts          registry of all variants

lib/types.ts            CV content types
references/             drop reference images here for Claude to see
```

## Running locally

```
npm install
npm run dev
```

Then visit <http://localhost:3000>.

## Making a new CV variant for a specific role

1. Copy `content/cvs/default.ts` to `content/cvs/<new-slug>.ts`, edit content.
2. Register it in `content/cvs/index.ts`.
3. Copy `app/cv/default/page.tsx` to `app/cv/<new-slug>/page.tsx` — this is where layout/design lives. Restyle freely.

## Exporting a PDF

Click **print / pdf** in the bottom-right toolbar, or press `⌘P`. Print CSS sizes the page to A4 and hides the toolbar.

## Talking to Claude about changes

Ways to communicate precisely:

- **Reference images** — drop PNG/JPG/PDF files into `references/`. Tell Claude the filename (e.g. "make it look like `references/magazine-spread.png`"). Claude can view images directly.
- **Design grid** — press `⌘G` (or click the button) to overlay a grid on the CV. Then reference positions: "move the name to the top-left of column 3".
- **Specific files** — point at files by path, e.g. "in `app/cv/default/page.tsx`, change the header to…".
- **Selectors** — right-click → Inspect in the browser, then tell Claude the element or the CSS class.
- **Screenshots of the current state** — take a screenshot, drop it into the chat, point to what to change.

## Typography

Defaults come from `next/font/google`: Inter (sans), Instrument Serif (display), JetBrains Mono (mono). To swap: edit `app/layout.tsx` and the CSS variables in `app/globals.css`. For fully custom fonts, drop `.woff2` files into `public/fonts/` and load them with `next/font/local`.

## Future

- Job application tracking (saved applications per CV variant)
- Scraped job posts → tailored draft CVs
- Application status dashboard
