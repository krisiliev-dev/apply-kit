import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { createGenericFiller } from "./generic.ts";
import { accountHelp } from "./account.ts";

describe("account and sign-in assistance", () => {
  it("fills only the job email, never reads passwords, and leaves terms and Create Account to the user", async () => {
    const doc = new Window({ url: "https://birch.example/account" }).document as unknown as Document;
    doc.body.innerHTML = '<form><h1>Create Account</h1><label>Email<input id="email" type="email"></label><input id="password" type="password"><input id="confirm" type="password"><label><input id="terms" type="checkbox">I agree to the terms</label><button>Create Account</button></form>';
    for (const el of Array.from(doc.querySelectorAll('input[type="password"]'))) Object.defineProperty(el, "value", { get() { throw new Error("password read"); }, set() { throw new Error("password written"); } });
    let submitted = false;
    doc.querySelector("form")!.addEventListener("submit", () => { submitted = true; });
    const filler = accountHelp(createGenericFiller({ settleMs: 0 }));
    expect(filler.read(doc).pageKind).toBe("account");
    await filler.fill(doc, [{ fieldId: "email", kind: "fill", value: "mira@example.com", source: "profile", basis: null }]);
    expect((doc.getElementById("email") as HTMLInputElement).value).toBe("mira@example.com");
    expect(Array.from(doc.querySelectorAll('input[type="password"]')).map((el) => el.getAttribute("autocomplete"))).toEqual(["new-password", "new-password"]);
    expect((doc.getElementById("terms") as HTMLInputElement).checked).toBe(false);
    expect(submitted).toBe(false);
    expect(filler.undo(doc)).toBe(1);
    expect((doc.getElementById("email") as HTMLInputElement).value).toBe("");
  });
  it("recognises a sign-in page and never rewrites its password autocomplete", () => {
    const doc = new Window({ url: "https://birch.example/signin" }).document as unknown as Document;
    doc.body.innerHTML = '<form><h1>Sign in</h1><input type="email"><input type="password" autocomplete="current-password"></form>';
    expect(accountHelp(createGenericFiller()).read(doc).pageKind).toBe("sign-in");
    expect(doc.querySelector('input[type="password"]')?.getAttribute("autocomplete")).toBe("current-password");
  });
});
