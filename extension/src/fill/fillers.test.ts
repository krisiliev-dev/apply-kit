// Which filler the injected script makes for a page, from the page's (or frame's) address.
import { describe, expect, it } from "vitest";
import { openFixture } from "./fixtures/load.ts";
import { fillerFor } from "./fillers.ts";

describe("the filler for a page", () => {
  it("reads each supported portal's form with its own filler, the embedded frames included", () => {
    const pages = [
      ["greenhouse-classic.html", "https://boards.greenhouse.io/vireohealth/jobs/4471029"],
      ["lever-apply.html", "https://jobs.lever.co/larkspur/3f6c2a1e-8b4d-4c7a-9e21-5d0b7a6c4f18/apply"],
      ["ashby-application.html", "https://jobs.ashbyhq.com/quillfeather/embed?version=2&ashby_jid=a2b4c6d8-1e3f-4a5b-8c7d-9e0f1a2b3c4d"],
    ] as const;
    for (const [fixture, url] of pages) {
      const page = openFixture(fixture, url);
      expect(fillerFor(url)!.read(page.document).fields.length, fixture).toBeGreaterThan(5);
    }
  });

  it("has no filler for portals that aren't filled yet or sites apply-kit doesn't know", () => {
    expect(fillerFor("https://apply.workable.com/dreamwire/j/A1B2C3D4E5/apply/")).toBeNull();
    expect(fillerFor("https://larkspur-logistics.example/careers")).toBeNull();
  });
});
