import { describe, expect, it } from "vitest";
import { parseAlertEmail } from "@/lib/discovery/email/parse";

describe("email alert parsing", () => {
  it("parses LinkedIn job-alert anchors with company + location", () => {
    const html = `<div>
      <a href="https://www.linkedin.com/comm/jobs/view/4055123/?trk=eml">Security Engineer</a>
      | Acme Corp | Sofia, Bulgaria
    </div>`;
    const out = parseAlertEmail({ from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", html });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "linkedin",
      url: "https://www.linkedin.com/jobs/view/4055123",
      title: "Security Engineer",
      company: "Acme Corp",
      location: "Sofia, Bulgaria",
    });
  });

  it("parses jobs.bg alert links", () => {
    const html = `<a href="https://www.jobs.bg/job/8469567">SOC Analyst</a>`;
    const out = parseAlertEmail({ from: "info@jobs.bg", html });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "jobsbg", title: "SOC Analyst", company: "jobs.bg" });
  });

  it("generic sender: keeps job-titled links, drops chrome like Unsubscribe", () => {
    const html = `
      <a href="https://x.com/1">Senior Security Engineer at Foo</a>
      <a href="https://x.com/u">Unsubscribe</a>`;
    const out = parseAlertEmail({ from: "noreply@example.com", html });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "capture", site: "example.com", title: "Senior Security Engineer at Foo" });
  });

  it("returns nothing for empty html", () => {
    expect(parseAlertEmail({ from: "x@linkedin.com", html: "" })).toEqual([]);
  });
});
