// Applications at scale (Track #36), at the tracker's public interface: the list query with search,
// Status / angle / date filters, paging inside a group and counts that follow the filters, over 214
// seeded Applications; and the "Since your last visit" line. Fake clock (Mon 12 Oct 2026, 10:30 in
// Sofia), in-memory database, made-up companies only.
import { describe, expect, it } from "vitest";
import { createTracker, type Status } from "../src/index.ts";
import { createTestEngine } from "./harness.ts";

function tracked() {
  const t = createTestEngine();
  const tracker = createTracker({ db: t.deps.db, clock: t.clock, discovery: t.engine });
  return { ...t, tracker };
}
type Tracker = ReturnType<typeof tracked>["tracker"];

const firsts = ["Amber", "Birch", "Cobalt", "Delta", "Ember", "Fjord", "Garnet", "Harbor", "Indigo", "Juniper", "Kestrel", "Lumen", "Maple", "Nimbus", "Onyx"];
const seconds = ["Labs", "Works", "Systems", "Pay", "Health", "Cloud", "Logistics", "Studio", "Data", "Robotics", "Maps", "Media", "Energy", "Games", "Bank"];
const titles = ["Security Engineer", "Frontend Developer", "Product Designer", "Backend Engineer", "SOC Analyst", "UX Researcher"];

/**
 * 214 Applications, as the hi-fi's "214 applications" state: 47 Applied, 9 Screening, 4
 * Interviewing, 1 Offer (61 open) and 153 closed (140 Rejected, 13 Withdrawn), applied from 3 Jun
 * to 12 Oct. The i-th one is at a made-up company named from the lists above.
 */
async function seed214(tracker: Tracker) {
  const plan: [Exclude<Status, "accepted">, number][] = [
    ["applied", 47], ["screening", 9], ["interviewing", 4], ["offer", 1], ["rejected", 140], ["withdrawn", 13],
  ];
  const start = Date.UTC(2026, 5, 3);
  const end = Date.UTC(2026, 9, 12);
  let i = 0;
  for (const [status, n] of plan) {
    for (let k = 0; k < n; k++, i++) {
      // Spread evenly from 3 Jun to 12 Oct, interleaved across Statuses.
      const day = new Date(start + Math.round(((i * 37) % 214) * ((end - start) / 213))).toISOString().slice(0, 10);
      const company = `${firsts[i % firsts.length]} ${seconds[Math.floor(i / firsts.length) % seconds.length]}`;
      const r = await tracker.addByHand({ job: { company, title: titles[i % titles.length]! }, appliedOn: day, status });
      if (r.outcome !== "added") throw new Error(`not added: ${r.outcome}`);
    }
  }
}

describe("searching Applications", () => {
  it("finds them by job or company, and the counts follow the search", async () => {
    const { tracker } = tracked();
    await seed214(tracker);

    const list = await tracker.list({ search: "nimbus" });

    expect(list.total).toBe(214);
    expect(list.matching).toBe(14);
    const shown = list.groups.flatMap((g) => g.applications);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((a) => a.company.startsWith("Nimbus"))).toBe(true);
    expect(Object.values(list.counts).reduce((a, b) => a + b, 0)).toBe(14);
  });
});
