export type DateRange = {
  start: string;
  end: string | "present";
};

export type Experience = {
  role: string;
  company: string;
  location?: string;
  dates: DateRange;
  summary?: string;
  bullets?: string[];
  tags?: string[];
};

export type Education = {
  school: string;
  degree: string;
  location?: string;
  dates: DateRange;
  notes?: string;
};

export type Project = {
  name: string;
  summary: string;
  url?: string;
  stack?: string[];
};

export type SkillGroup = {
  label: string;
  items: string[];
};

export type Profile = {
  name: string;
  title: string;
  email: string;
  location?: string;
  phone?: string;
  links?: { label: string; href: string }[];
  summary?: string;
};

export type CVContent = {
  slug: string;
  targetRole: string;
  profile: Profile;
  experiences: Experience[];
  education: Education[];
  projects?: Project[];
  skills?: SkillGroup[];
  interests?: string[];
};
