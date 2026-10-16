import { afterEach, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { createGenericFiller } from "./generic.ts";
import { runFiller } from "./in-page.ts";
afterEach(() => vi.unstubAllGlobals());
it("refuses to apply the old document's answers after navigation, including SPA navigation", async () => {
  const doc = new Window({ url: "https://birch.example/job-b" }).document as unknown as Document;
  doc.body.innerHTML = '<label>Name<input id="name"></label>';
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { href: "https://birch.example/job-b" });
  vi.stubGlobal("applyKitFiller", createGenericFiller({ settleMs: 0 }));
  const run = runFiller as (command: "fill", args: unknown[], expectedAddress?: string) => unknown;
  const result = await run("fill", [[{ fieldId: "name", kind: "fill", value: "Mira", source: "profile", basis: null }], []], "https://birch.example/job-a");
  expect(result).toBeNull();
  expect((doc.getElementById("name") as HTMLInputElement).value).toBe("");
});
