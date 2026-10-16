import { describe, expect, it } from "vitest";
import { findVerificationLink } from "../src/fill/verification.ts";
const session = { portal: "workday", host: "kestrel.wd3.myworkdayjobs.com", tenant: "kestrel", startedAt: "2026-10-16T10:00:00Z" };
const now = new Date("2026-10-16T10:10:00Z");
const mail = { from: "Workday <noreply@myworkday.com>", receivedAt: "2026-10-16T10:01:00Z", text: "Verify your account: https://kestrel.wd3.myworkdayjobs.com/verify?token=secret", html: "" };
describe("portal verification email", () => {
  it("offers the current tenant's recent HTTPS verification link", () => {
    expect(findVerificationLink(session, [mail], now)).toBe("https://kestrel.wd3.myworkdayjobs.com/verify?token=secret");
  });
  it.each([
    { ...mail, receivedAt: "2026-10-15T10:01:00Z" },
    { ...mail, from: "Workday <fraud@evil.example>" },
    { ...mail, text: "https://other.wd3.myworkdayjobs.com/verify?token=wrong" },
    { ...mail, text: "https://kestrel.wd3.myworkdayjobs.com.evil.example/verify" },
    { ...mail, text: "http://kestrel.wd3.myworkdayjobs.com/verify" },
    { ...mail, text: "https://kestrel.wd3.myworkdayjobs.com/jobs" },
  ])("ignores stale, unrelated or unsafe mail %#", (m) => {
    expect(findVerificationLink(session, [m], now)).toBeNull();
  });
});
