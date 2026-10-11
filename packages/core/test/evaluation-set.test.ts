// The labelled evaluation set itself (eval/extraction/postings): every file is a valid case, and the
// set keeps the spread #11 asks for. Cheap and offline; running the extractor over it is a separate,
// on-demand command (pnpm eval:extraction).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluationCaseSchema } from "../src/index.ts";

const dir = new URL("../../../eval/extraction/postings/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const cases = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(new URL(f, dir), "utf8")) as unknown }));

describe("the extraction evaluation set", () => {
  it.each(cases)("$file is a valid labelled posting named after its id", ({ file, data }) => {
    const c = evaluationCaseSchema.parse(data);
    expect(file).toBe(`${c.id}.json`);
  });

  it("has about 50 postings across dev, security and design, at least 12 of them in Bulgarian", () => {
    const parsed = cases.map(({ data }) => evaluationCaseSchema.parse(data));
    expect(parsed.length).toBeGreaterThanOrEqual(45);
    expect(parsed.filter((c) => c.expected.language === "bg").length).toBeGreaterThanOrEqual(12);
    for (const field of ["dev", "security", "design"] as const) {
      expect(parsed.filter((c) => c.field === field).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("holds no email addresses or phone numbers", () => {
    for (const { file, data } of cases) {
      const text = JSON.stringify(data);
      expect(text, file).not.toMatch(/[\w.%+-]+@[\w-]+\.[\w.-]+/);
      expect(text, file).not.toMatch(/(\+359|\b0\d{1,3}[ /-]?\d{3})[ -]?\d{3,4}\b/);
    }
  });
});
