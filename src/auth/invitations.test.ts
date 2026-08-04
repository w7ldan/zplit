import { describe, expect, it, vi } from "vitest";
import {
  generateInvitationToken,
  hashInvitationToken,
  isInvitationToken,
  normalizeInvitationEmail,
  normalizeSuggestedName,
  validateInvitationEmail,
  validateInvitePassword,
  validateSuggestedName,
} from "./invitations";

vi.mock("server-only", () => ({}));

describe("invitation primitives", () => {
  it("generates a 32-byte token and stores only its sha256-sized digest", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isInvitationToken(token)).toBe(true);
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(token)).not.toBe(token);
    expect(isInvitationToken("not-a-token")).toBe(false);
  });

  it("normalizes bounded invite fields and enforces the password floor", () => {
    expect(normalizeInvitationEmail("  PERSON@Example.COM ")).toBe("person@example.com");
    expect(normalizeSuggestedName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(validateInvitationEmail("person@example.com")).toBe(true);
    expect(validateInvitationEmail("person@example")).toBe(false);
    expect(validateSuggestedName("Ada")).toBe(true);
    expect(validateSuggestedName("a".repeat(121))).toBe(false);
    expect(validateInvitePassword("short")).toMatch(/at least 16/);
    expect(validateInvitePassword("a".repeat(16))).toBe("");
  });
});
