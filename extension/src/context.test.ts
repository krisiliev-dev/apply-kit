import { describe, expect, it } from "vitest";
import { contextCard, fillStateFor, openingView } from "./context.ts";
import { recognisePortal } from "./portal.ts";

const workday = "https://kestrelpayments.wd3.myworkdayjobs.com/en-US/Kestrel_Careers/job/Sofia/Security-Engineer_R-10482/apply/applyManually";
const greenhouse = "https://job-boards.eu.greenhouse.io/vireohealth/jobs/4471029";
const own = "https://careers.ostravabank.example/bg/kandidatstvai/it-security-specialist";

describe("which view the panel opens on", () => {
  it("opens on Fill on a recognised portal and on Capture anywhere else", () => {
    expect(openingView(recognisePortal(workday))).toBe("fill");
    expect(openingView(recognisePortal("https://jobs.lever.co/nordlicht"))).toBe("fill");
    expect(openingView(recognisePortal(own))).toBe("capture");
    expect(openingView(recognisePortal(undefined))).toBe("capture");
  });
});

describe("what the Fill view shows before anything is filled", () => {
  it("asks once for the six portals on the first use on a portal, then shows the portal", () => {
    const page = recognisePortal(workday);
    expect(fillStateFor({ address: workday, page, portals: "not-asked" })).toBe("allow-portals");
    expect(fillStateFor({ address: workday, page, portals: "granted" })).toBe("portal");
    expect(fillStateFor({ address: workday, page, portals: "not-now" })).toBe("portal");
  });

  it("doesn't ask for the portals on other sites, and says when Chrome hides the tab's address", () => {
    expect(fillStateFor({ address: own, page: recognisePortal(own), portals: "not-asked" })).toBe("not-portal");
    expect(fillStateFor({ address: undefined, page: recognisePortal(undefined), portals: "not-asked" })).toBe("no-access");
    expect(fillStateFor({ address: "chrome://extensions/", page: recognisePortal("chrome://extensions/"), portals: "granted" })).toBe("chrome-page");
    expect(fillStateFor({ address: "https://chromewebstore.google.com/detail/x", page: recognisePortal("https://chromewebstore.google.com/detail/x"), portals: "granted" })).toBe("chrome-page");
  });
});

describe("the context card", () => {
  it("names the portal, the company's board and the job id from the address, with the tab's title as the job", () => {
    expect(contextCard(recognisePortal(workday), { address: workday, title: "Security Engineer" })).toEqual({
      where: "Workday · kestrelpayments",
      job: "Security Engineer",
      why: "Job R-10482, from the page address. Nothing on the page has been read or filled.",
    });
  });

  it("reads the job and company from a Greenhouse application's title", () => {
    expect(contextCard(recognisePortal(greenhouse), { address: greenhouse, title: "Job Application for Platform Security Engineer at Vireo Health" })).toEqual({
      where: "Greenhouse · Vireo Health",
      job: "Platform Security Engineer",
      why: "Job 4471029, from the page address. Nothing on the page has been read or filled.",
    });
  });

  it("says when the address names no job, and when it's a site apply-kit doesn't know", () => {
    const list = "https://jobs.lever.co/nordlicht";
    expect(contextCard(recognisePortal(list), { address: list, title: "" })).toEqual({
      where: "Lever",
      job: "No job on this page yet",
      why: "Open the job's application form, then come back to this panel.",
    });
    expect(contextCard(recognisePortal(own), { address: own, title: "IT Security Specialist | Ostrava Bank" })).toEqual({
      where: "Not a portal apply-kit knows · careers.ostravabank.example",
      job: "IT Security Specialist | Ostrava Bank",
      why: "apply-kit fills nothing here by default. You can still capture the job.",
    });
  });

  it("says where a Greenhouse job on a company's own page came from", () => {
    const company = "https://careers.vireo.example/open-roles/?gh_jid=4471029";
    expect(contextCard(recognisePortal(company), { address: company, title: "Open roles · Vireo" })).toEqual({
      where: "Greenhouse · careers.vireo.example",
      job: "Open roles · Vireo",
      why: "Job 4471029, from the page address (a Greenhouse form inside the company's page). Nothing on the page has been read or filled.",
    });
  });
});
