import { describe, expect, it } from "vitest";
import { parseCascadeConfirmation, parseImpactRevision } from "./deletion-confirmation";

const revision = "a".repeat(64);

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("deletion confirmation parsing", () => {
  it("accepts only one valid cascade confirmation", () => {
    expect(parseCascadeConfirmation(form({}))).toBe(false);
    expect(parseCascadeConfirmation(form({ confirmCascade: "delete-dependents" }))).toBe(true);
    expect(() => parseCascadeConfirmation(form({ confirmCascade: "other" }))).toThrow("Cascade confirmation is invalid.");
  });

  it("accepts exactly one lowercase hexadecimal impact revision", () => {
    expect(parseImpactRevision(form({ impactRevision: revision }))).toBe(revision);
    expect(parseImpactRevision(form({}))).toBeNull();
    expect(parseImpactRevision(form({ impactRevision: "bad" }))).toBeNull();
  });
});
