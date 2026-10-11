// Email-alert Sources: one per sender (LinkedIn, jobs.bg, Google Careers, Workday, MyGreenhouse),
// all read from the dedicated job mailbox. Config is the sender, e.g. "linkedin"; the Source id is
// "email:linkedin". Postings are keyed by the job's own id on the sender's site, never by the email,
// so the same job in tomorrow's alert (or a re-delivered copy) updates one Posting.
import type { EmailAlertAdapter, FoundPosting } from "./adapter.ts";
import { jobCards } from "./email/cards.ts";
import { readEmailHtml } from "./email/html.ts";
import { parseFrom, senders, type SenderKey } from "./email/senders.ts";

export interface EmailAlertConfig {
  sender: SenderKey;
}

const known = Object.keys(senders) as SenderKey[];

export const emailAlerts: EmailAlertAdapter<EmailAlertConfig> = {
  kind: "email",
  category: "email",

  parseConfig(raw) {
    const sender = typeof raw === "string" ? raw : (raw as { sender?: unknown } | null)?.sender;
    const key = typeof sender === "string" ? sender.trim().toLowerCase() : "";
    if (!known.includes(key as SenderKey)) {
      throw new Error(`An email alert source needs one of ${known.join(", ")}, got ${JSON.stringify(raw)}`);
    }
    return { sender: key as SenderKey };
  },

  key: (c) => c.sender,
  defaultName: (c) => senders[c.sender].name,

  isFrom: (c, email) => senders[c.sender].isFrom(parseFrom(email.from), email.subject),

  parseEmail(c, email) {
    const sender = senders[c.sender];
    return jobCards(readEmailHtml(email.html), sender.jobLink).map((card): FoundPosting => ({
      externalId: card.id,
      url: card.url,
      title: card.title,
      ...withCompany(sender.readCard(card, email), sender.name),
      // Alerts list jobs published since the previous alert; the email's time is the best date we have.
      postedAt: email.receivedAt.toISOString(),
      descriptionHtml: null,
    }));
  },

  async fetchPostings(c, ctx) {
    if (!ctx.mail) throw new Error("Email alert sources need the job mailbox");
    return (await ctx.mail()).filter((e) => this.isFrom(c, e)).flatMap((e) => this.parseEmail(c, e));
  },
};

function withCompany(facts: { company: string | null; location: string | null; salary: string | null }, fallback: string) {
  return { company: facts.company ?? fallback, location: facts.location, salary: facts.salary };
}
