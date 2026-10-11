// The three Angles and the words that point to each one, matched as whole words (Latin and
// Cyrillic) against a Job's title and requirements. Data, not logic: edit freely. A starting list
// until the master profile exists; keep entries specific ("iam", not "access"), since a word that
// belongs to every angle tells nothing.

export const angles = ["developer", "security", "design"] as const;
export type Angle = (typeof angles)[number];

export const angleKeywords: Record<Angle, string[]> = {
  developer: [
    "developer", "software engineer", "software developer", "programmer", "frontend", "front end", "backend", "back end",
    "full stack", "fullstack", "web developer", "mobile developer", "javascript", "typescript", "react", "node", "nodejs",
    "vue", "angular", "python", "java", "golang", "kotlin", "swift", "ios", "android", "dotnet", "php", "ruby", "rails",
    "django", "sql", "postgres", "devops", "sre", "api", "microservices", "docker",
    "разработчик", "програмист", "софтуерен инженер", "уеб разработчик",
  ],
  security: [
    "security", "cybersecurity", "cyber", "infosec", "information security", "soc", "siem", "splunk", "elastic",
    "incident response", "threat", "threat intelligence", "detection", "pentest", "pentester", "penetration testing", "penetration tester", "ethical hacker",
    "appsec", "application security", "devsecops", "iam", "identity and access", "grc", "vulnerability", "forensics",
    "dfir", "malware", "red team", "blue team", "security operations", "cissp", "oscp", "cism", "iso 27001", "27001",
    "сигурност", "киберсигурност", "информационна сигурност",
  ],
  design: [
    "designer", "design", "ux", "ui", "user experience", "user interface", "product designer", "ux designer", "ui designer",
    "figma", "sketch", "user research", "prototyping", "interaction design", "visual design", "design system",
    "accessibility", "usability",
    "дизайнер", "дизайн",
  ],
};

export const angleLabel: Record<Angle, string> = { developer: "Developer", security: "Security", design: "Design" };
