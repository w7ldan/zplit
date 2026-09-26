import { describe, expect, it } from "vitest";
import { readSource } from "./helpers";

const landing = readSource("src/components/marketing/money-trail.tsx");
const interactions = readSource(
  "src/components/marketing/money-trail-interactions.tsx",
);
const css = readSource("src/app/styles/75-money-trail.css");
const access = readSource("src/app/styles/70-public-auth-vnext.css");

describe("Public UI contract", () => {
  it("owns the new landing separately from access forms", () => {
    expect(landing).toContain("trail-hero");
    expect(landing).toContain("Bandung day out");
    expect(interactions).toContain('href="/login"');
    expect(interactions).toContain('href="#record"');
    expect(css).toContain(".trail-header-scrolled");
    expect(access).toContain(".access-vnext");
    expect(access).not.toContain(".trail-");
    expect(css).not.toMatch(/gradient|backdrop-filter|box-shadow/i);
  });

  it("keeps public examples scoped and explicit", () => {
    expect(landing).toContain("temporary, revocable link");
    expect(landing).toMatch(/Repayment destination and receipt appear only when the owner\s+enables them\./);
    expect(interactions).toContain("Pending confirmation");
    expect(interactions).toContain("Offset · not cash");
    expect(interactions).toContain("private Budget");
    expect(interactions).not.toMatch(
      /trusted by|Get started free|public signup/i,
    );
  });
});
