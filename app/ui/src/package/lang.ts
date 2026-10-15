// The language of a piece of text the page shows, for `lang` (WCAG 3.1.2, PA-14): Bulgarian when it
// is written in Cyrillic, so a screen reader reads a Bulgarian line in Bulgarian inside an English page.
const CYRILLIC = /\p{Script=Cyrillic}/u;

export const langOf = (text: string | null | undefined): "bg" | undefined => (text && CYRILLIC.test(text) ? "bg" : undefined);
