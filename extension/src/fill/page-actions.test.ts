import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { choose, setValue } from "./page-actions.ts";
const document = (html: string) => { const doc = new Window({ url: "https://birch.example/" }).document as unknown as Document; doc.body.innerHTML = html; return doc; };
describe("guarded form-control actions", () => {
  it.each(['', ' type="submit"'])("refuses a list option implemented as a submit button: %s", (type) => {
    const doc = document(`<form><div role="listbox"><button role="option"${type}>Sofia</button></div></form>`);
    let submitted = false;
    doc.querySelector("form")!.addEventListener("submit", (e) => { e.preventDefault(); submitted = true; });
    expect(choose(doc.querySelector("button")!)).toBe(false);
    expect(submitted).toBe(false);
  });
  it("leaves Yes/No consent and consent dropdowns for the user", () => {
    const doc = document('<fieldset><legend>Do you consent to marketing?</legend><div><button type="button">Yes</button><button type="button">No</button></div></fieldset><label>Do you agree to the terms?<select><option>No</option><option>Yes</option></select></label>');
    expect(choose(doc.querySelector("button")!)).toBe(false);
    expect(setValue(doc.querySelector("select")!, "Yes", "Do you agree to the terms?")).toBe(false);
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("No");
  });
});

it("stops delayed actions when the document navigates during a fill", async () => {
  const { bindDocument } = await import("./page-actions.ts");
  const doc = document('<label>Name<input id="name"></label>');
  doc.defaultView!.history.replaceState({}, "", "https://birch.example/job-a");
  bindDocument(doc);
  doc.defaultView!.history.replaceState({}, "", "https://birch.example/job-b");
  expect(setValue(doc.getElementById("name")!, "Mira", "Name")).toBe(false);
  expect((doc.getElementById("name") as HTMLInputElement).value).toBe("");
});
