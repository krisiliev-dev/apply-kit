// The answers every bank starts with (ticket #56): salary as "ask each time" with its rule, diversity
// questions left blank, and standard answers taken from the contact details once Kris saves them.
// Each has a key, so a default Kris deleted isn't added again and one he hasn't edited follows his
// contact details when they change.
import type { ContactDetails } from "./contact.ts";
import type { AnswerInput } from "./answers.ts";

export interface DefaultAnswer {
  key: string;
  /** "Added as a default" or "From your contact details". */
  from: string;
  input: AnswerInput;
}

const contactSource = "From your contact details";
const defaultSource = "Added as a default";

const euros = (n: number) => `€${n.toLocaleString("en-GB")}`;

/** The defaults for these contact details and this salary floor (gross per month, euros). */
export function defaultAnswers(contact: ContactDetails, salaryFloor: number | null): DefaultAnswer[] {
  const defaults: DefaultAnswer[] = [
    {
      key: "salary",
      from: defaultSource,
      input: {
        question: "Salary expectations",
        wordings: [
          "Expected salary", "Desired salary", "What are your salary expectations?", "Expected gross monthly salary",
          "Желано възнаграждение", "Очаквано възнаграждение", "Желана заплата",
        ],
        category: "standard",
        kind: "rule",
        mode: "ask",
        rule: {
          text: `Upper half of the posting's stated range${salaryFloor ? `, never under ${euros(salaryFloor)} a month` : ""}`,
          params: { kind: "salary", take: "upper-half", floor: salaryFloor, currency: "EUR" },
        },
      },
    },
    {
      key: "diversity",
      from: defaultSource,
      input: {
        question: "Gender, ethnicity and other diversity questions",
        wordings: [
          "Gender", "Ethnicity", "Race", "Race or ethnicity", "Disability", "Disability status", "Protected veteran status",
          "Sexual orientation", "Пол", "Етническа принадлежност", "Етнически произход", "Увреждане",
        ],
        versions: { en: "Prefer not to say", bg: "Предпочитам да не посоча" },
        category: "standard",
        kind: "choice",
        mode: "blank",
      },
    },
  ];

  const same = (key: string, question: string, wordings: string[], value: string, both = true) => {
    if (!value) return;
    defaults.push({
      key,
      from: contactSource,
      input: { question, wordings, versions: both ? { en: value, bg: value } : { en: value }, category: "standard", kind: "text", mode: "fill" },
    });
  };
  same("contact:email", "Email", ["Email address", "E-mail", "Имейл", "Имейл адрес", "Електронна поща"], contact.email);
  same("contact:phone", "Phone number", ["Phone", "Mobile number", "Телефон", "Телефонен номер"], contact.phone);
  same("contact:location", "Where are you based?", ["Current location", "Location", "City", "Where do you live?"],
    [contact.city, contact.country].filter(Boolean).join(", "), false);
  const linkedin = contact.links.find((l) => /(^|\.)linkedin\.com$/i.test(host(l)));
  const github = contact.links.find((l) => /(^|\.)github\.com$/i.test(host(l)));
  const site = contact.links.find((l) => l !== linkedin && l !== github);
  same("contact:linkedin", "LinkedIn profile", ["LinkedIn", "LinkedIn URL", "Профил в LinkedIn"], linkedin ?? "");
  same("contact:github", "GitHub profile", ["GitHub", "GitHub URL"], github ?? "");
  same("contact:website", "Portfolio or website", ["Portfolio", "Website", "Personal website", "Portfolio URL", "Портфолио", "Уебсайт"], site ?? "");
  return defaults;
}

function host(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return "";
  }
}
