import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { createGenericFiller } from "./generic.ts";

const page = () => {
  const doc = new Window({ url: "https://birch.example/apply" }).document as unknown as Document;
  doc.body.innerHTML = `<form><label for="name">Име и фамилия</label><input id="name"><label>Email<input name="email" type="email"></label><input name="phone_number" aria-label="Телефон"><textarea name="explanation" aria-labelledby="why"></textarea><b id="why">Защо кандидатствате?</b><input name="unknown"><input type="password" name="password"><button type="submit">Изпрати</button></form>`;
  return doc;
};
describe("unknown company forms", () => {
  it("reads Bulgarian labels in form order and fills only clear labels with undo", async () => {
    const doc = page();
    let submitted = false;
    doc.querySelector("form")!.addEventListener("submit", (e) => { e.preventDefault(); submitted = true; });
    const filler = createGenericFiller({ settleMs: 0 });
    expect(filler.read(doc).fields.slice(0, 4).map((f) => f.label)).toEqual(["Име и фамилия", "Email", "Телефон", "Защо кандидатствате?"]);
    const outcomes = await filler.fill(doc, [
      { fieldId: "name", kind: "fill", value: "Mira Petrova", source: "profile", basis: null },
      { fieldId: "unknown", kind: "fill", value: "never guessed", source: "profile", basis: null },
    ]);
    expect((doc.getElementById("name") as HTMLInputElement).value).toBe("Mira Petrova");
    expect((doc.querySelector('[name="unknown"]') as HTMLInputElement).value).toBe("");
    expect(outcomes.map((o) => o.outcome)).toEqual(["filled", "skipped"]);
    expect(filler.undo(doc)).toBe(1);
    expect(submitted).toBe(false);
  });
});
