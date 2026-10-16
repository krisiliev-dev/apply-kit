// Which contact detail a portal field asks for, from its label (English and Bulgarian) or its
// autocomplete token, and the master profile's value for it. Pure. A label it doesn't recognise
// gets nothing: guessing a contact field is never worth a wrong value.
import type { ProfileForApply } from "../preparation/contracts.ts";
import type { ReadField } from "./reading.ts";

export type ContactKey = "givenName" | "familyName" | "fullName" | "email" | "phone" | "countryCode" | "location" | "city" | "country" | "linkedin" | "github" | "portfolio";

/** Lower case, accents and punctuation gone, "(optional)" and "*" dropped, spaces collapsed. Unicode-safe for Cyrillic. */
export function normaliseLabel(label: string): string {
  return label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\((optional|required|по желание|задължително)\)/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const byLabel: [ContactKey, RegExp][] = [
  ["countryCode", /^(phone |mobile )?country code$|^country (phone |dial(ling)? )code$|^dial(ling)? code$/u],
  ["givenName", /^(legal |your )?(first|given) name$|^first$|^име$/u],
  ["familyName", /^(legal |your )?(last|family) name$|^surname$|^last$|^фамилия$/u],
  ["fullName", /^(full |your |legal )?name$|^име и фамилия$|^имена$/u],
  ["email", /^(confirm |re enter |your )?(e ?mail)( address)?$|^имейл$/u],
  ["phone", /^(mobile |cell |contact |your )?(phone|telephone)( number)?$|^mobile( number)?$|^телефон$/u],
  ["city", /^(location )?city$|^town$|^град$|^location city$/u],
  ["location", /^(current )?location$|^where are you based$|^местоположение$/u],
  ["country", /^country( of residence)?$|^държава$/u],
  ["linkedin", /\blinked ?in\b/u],
  ["github", /\bgit ?hub\b/u],
  ["portfolio", /^(personal )?(portfolio|website|web site|site)( url| link)?$|^portfolio .*$/u],
];

const byHint: Record<string, ContactKey> = {
  "given-name": "givenName", "family-name": "familyName", name: "fullName", email: "email", tel: "phone",
  "tel-country-code": "countryCode", "address-level2": "city", "country-name": "country", country: "country", url: "portfolio",
};

/** What a missing value is called, for "Your profile has no …". */
const missingName: Record<ContactKey, string> = {
  givenName: "first name", familyName: "family name", fullName: "name", email: "email address", phone: "phone number", countryCode: "phone number",
  location: "city", city: "city", country: "country", linkedin: "LinkedIn link", github: "GitHub link", portfolio: "website",
};

/** What each contact field asks for, in English (the copy list's meaning beside a form's own label). */
const meaningOf: Record<ContactKey, string> = {
  givenName: "first name", familyName: "family name", fullName: "full name", email: "email", phone: "phone", countryCode: "phone country code",
  location: "location", city: "city", country: "country", linkedin: "LinkedIn", github: "GitHub", portfolio: "website",
};

export interface ContactValue {
  /** Which contact detail the field asks for. */
  key: ContactKey;
  /** Null when the profile has nothing for it. */
  value: string | null;
  /** What the field asks for, in English ("full name"). */
  meaning: string;
  basis: string | null;
  /** "Your profile has no GitHub link". */
  missing: string;
}

function contactKey(field: ReadField): ContactKey | undefined {
  const label = normaliseLabel(field.label);
  return byLabel.find(([, re]) => re.test(label))?.[0] ?? (field.hint ? byHint[field.hint.toLowerCase()] : undefined);
}

/**
 * The contact detail this field asks for and the profile's value, or null when it isn't a contact
 * field. `page`: the page's other fields; a phone field on a page with a country code field of its own
 * gets the national number (the field's format), and says where the code went.
 */
export function contactValue(field: ReadField, profile: ProfileForApply, page: ReadField[] = []): ContactValue | null {
  const key = contactKey(field);
  if (!key) return null;
  const c = profile.contact;
  const codeField = key === "phone" && c.phone ? page.find((f) => f !== field && contactKey(f) === "countryCode") : undefined;
  if (codeField && c.phone) {
    return { key, value: c.phone.national, meaning: "phone number without the country code", basis: `Without ${c.phone.countryCode}, which is in ${codeField.label}`, missing: `Your profile has no ${missingName.phone}` };
  }
  const value: string | null = {
    givenName: c.givenName, familyName: c.familyName, fullName: c.fullName, email: c.email,
    phone: c.phone?.full ?? null, countryCode: c.phone?.countryCode ?? null,
    location: [c.city, c.country].filter(Boolean).join(", "), city: c.city, country: c.country,
    linkedin: c.linkedin, github: c.github, portfolio: c.portfolio,
  }[key] || null;
  return { key, value, meaning: meaningOf[key], basis: key === "email" ? "Your job address" : null, missing: `Your profile has no ${missingName[key]}` };
}
