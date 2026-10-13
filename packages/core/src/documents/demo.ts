// The fictional demo profile from the CV template hi-fi (docs/design/hifi/cv-template.html), for
// checking the template by eye and in the rendering smoke test. Nia Koleva, her employers and
// school are made up; no real person's data.
import type { CvContent, DocumentLanguage, DocumentPhoto, DocumentToRender, Letterhead, LetterContent } from "./content.ts";
import type { FileNameParts } from "./file-names.ts";

const contact = {
  email: "nia.koleva@example.com",
  phone: "+359 88 000 0142",
  links: ["linkedin.com/in/nia-koleva-example"],
};

const letterheads: Record<DocumentLanguage, Letterhead> = {
  en: { name: "Nia Koleva", headline: "Security Analyst", location: "Sofia, Bulgaria", ...contact },
  bg: { name: "Ния Колева", headline: "Анализатор по информационна сигурност", location: "София, България", ...contact },
};

const cvs: Record<DocumentLanguage, CvContent> = {
  en: {
    letterhead: letterheads.en,
    summary: "Security analyst with 3 years in security operations: detection engineering in Splunk, alert triage and phishing response in a bank SOC. Moving detection work to Elastic and comfortable scripting in Python.",
    experience: [
      {
        title: "Junior Security Analyst", employer: "Orbital Bank", place: "Sofia", start: { year: 2023, month: 1 }, end: "present",
        bullets: [
          "Built 40 Splunk detections that cut false positives by about a third",
          "Rewrote noisy login rules around how staff actually signed in, not vendor templates",
          "Triaged about 25 alerts a day in a 6-person SOC",
          "Responded to 3 phishing incidents, leading 1 from first alert to write-up",
        ],
      },
      {
        title: "SOC Intern", employer: "Varna Telecom", place: "Varna", start: { year: 2022, month: 6 }, end: { year: 2022, month: 8 },
        bullets: [
          "Monitored SIEM alerts on the night shift and escalated confirmed incidents",
          "Wrote Python scripts to enrich alerts with asset and owner data",
        ],
      },
      {
        title: "Freelance Full-stack Developer", employer: "Self-employed", place: "Varna", start: { year: 2021, month: 3 }, end: { year: 2022, month: 12 },
        bullets: [
          "Built a booking site with Stripe deposits and calendar sync for a dental clinic",
          "Built and hosted web apps for small businesses (React, Node.js, Linux servers)",
        ],
      },
    ],
    skills: ["Splunk (SPL, detection engineering)", "Elastic SIEM", "Incident response", "Python", "Linux", "Bash", "React", "Node.js"],
    education: [{ degree: "BSc Computer Science", school: "Danube Institute of Technology", start: { year: 2018 }, end: { year: 2022 } }],
    languagesAndCourses: ["Bulgarian (native)", "English (C1)", "Elastic SIEM course (2026)"],
  },
  bg: {
    letterhead: letterheads.bg,
    summary: "Анализатор по сигурност с 3 години опит в операциите по сигурност: разработка на детекции в Splunk, обработка на сигнали и реакция при фишинг инциденти в SOC на банка.",
    experience: [
      {
        title: "Младши анализатор по сигурност", employer: "Орбитал Банк", place: "София", start: { year: 2023, month: 1 }, end: "present",
        bullets: [
          "Създадох 40 детекции в Splunk, с които фалшивите сигнали намаляха с около една трета",
          "Обработвах около 25 сигнала на ден в екип от 6 души",
          "Участвах в реакцията при 3 фишинг инцидента и ръководих един от тях до финалния доклад",
        ],
      },
      {
        title: "Стажант в SOC", employer: "Варна Телеком", place: "Варна", start: { year: 2022, month: 6 }, end: { year: 2022, month: 8 },
        bullets: ["Написах Python скриптове, които добавят данни за активи и собственици към сигналите"],
      },
    ],
    skills: ["Splunk (SPL)", "Elastic SIEM", "Реакция при инциденти", "Python", "Linux", "Bash"],
    education: [{ degree: "Бакалавър, Компютърни науки", school: "Дунавски технологичен институт", start: { year: 2018 }, end: { year: 2022 } }],
    languagesAndCourses: ["Български (роден)", "Английски (C1)", "Курс Elastic SIEM (2026)"],
  },
};

const letters: Record<DocumentLanguage, LetterContent> = {
  en: {
    letterhead: letterheads.en,
    date: "2026-10-13",
    recipient: { company: "Kestrel Payments", place: "Sofia, Bulgaria" },
    re: { role: "Security Engineer", reference: "R-10482" },
    greeting: "Dear Kestrel hiring team,",
    paragraphs: [
      "Kestrel moves money for 12,000 merchants, which means every false alarm in your SOC costs an analyst's time and every missed one can cost a merchant. Telling those two apart is the part of security work I have spent the last three years on, and it is why the Security Engineer role stood out to me.",
      "At Orbital Bank I built 40 Splunk detections for a six-person SOC and cut our false positives by about a third, mostly by rewriting noisy rules around how our staff actually signed in rather than how the vendor templates assumed they did. Triaging around 25 alerts a day taught me which detections earn their place and which only create work. I also responded to three phishing incidents and led one of them from the first alert to the write-up.",
      "Your posting mentions moving detection work onto Elastic and hardening the Kubernetes platform. Elastic would be a short step from Splunk for me. Kubernetes security I haven't done in production, and I would want to close that gap early rather than talk around it. I would like to hear where the team wants its detections to be a year from now.",
    ],
    closing: "Kind regards,",
  },
  bg: {
    letterhead: letterheads.bg,
    date: "2026-10-13",
    recipient: { company: "Кестрел Плащания", place: "София, България" },
    re: { role: "Инженер по сигурност", reference: "R-10482" },
    greeting: "Здравейте,",
    paragraphs: [
      "Кестрел обработва плащания за 12 000 търговци, затова всеки фалшив сигнал във вашия SOC струва време на анализатор, а всеки пропуснат може да струва на търговец. Да различавам двете е работата, с която се занимавам последните три години, и затова позицията Инженер по сигурност ме привлече.",
      "В Орбитал Банк създадох 40 детекции в Splunk за екип от шестима и намалихме фалшивите сигнали с около една трета, най-вече като пренаписах шумните правила според това как служителите реално влизат в системите. Обработката на около 25 сигнала на ден ме научи кои детекции си заслужават и кои само създават работа.",
      "В обявата споменавате преминаване към Elastic и защита на Kubernetes платформата. Elastic би бил кратка стъпка след Splunk. Със сигурност на Kubernetes нямам опит в продукционна среда и бих искала да наваксам рано, вместо да го заобикалям.",
    ],
    closing: "Поздрави,",
  },
};

/** A neutral stand-in for the profile photo, 4:5 like the slot. */
const demoPhoto: DocumentPhoto = {
  mediaType: "image/svg+xml",
  bytes: new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50"><rect width="40" height="50" fill="#d5ddd8"/>'
    + '<circle cx="20" cy="19" r="8" fill="#879690"/><path d="M6 50c0-10 6-16 14-16s14 6 14 16z" fill="#879690"/></svg>',
  ),
};

/** Names the demo files after, in Latin script whatever the language. */
export const demoFileName: FileNameParts = { name: "Nia Koleva", company: "Kestrel Payments", role: "Security Engineer" };

export interface DemoOptions {
  kind: DocumentToRender["kind"];
  language: DocumentLanguage;
  /** The CV's photo slot; ignored for the letter. */
  photo: boolean;
}

export function demoDocument({ kind, language, photo }: DemoOptions): DocumentToRender {
  const name = letterheads[language].name;
  if (kind === "cover-letter") {
    return { kind, language, title: `${name} · ${language === "bg" ? "Мотивационно писмо" : "Cover letter"} · ${letters[language].recipient.company}`, content: letters[language] };
  }
  const content = photo ? { ...cvs[language], photo: demoPhoto } : cvs[language];
  return { kind, language, title: `${name} · CV · ${letters[language].recipient.company}`, content };
}
