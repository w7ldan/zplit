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
  resolveInstallationOwner,
} from "./invitations";

vi.mock("server-only", () => ({}));

describe("invitation primitives", () => {
  it("generates a 32-byte token and stores only its sha256-sized digest", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isInvitationToken(token)).toBe(true);
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(token)).not.toBe(token);
    expect(isInvitationToken("not-a-token")).toBe(false);
    expect(isInvitationToken(`${token}=`)).toBe(false);
    expect(isInvitationToken(`${token}A`)).toBe(false);
  });

  it("normalizes bounded invite fields and enforces the password floor", () => {
    expect(normalizeInvitationEmail("  PERSON@Example.COM ")).toBe("person@example.com");
    expect(normalizeSuggestedName("  Ada   Lovelace ")).toBe("Ada   Lovelace");
    expect(validateInvitationEmail("person@example.com")).toBe(true);
    expect(validateInvitationEmail("person@example")).toBe(false);
    expect(validateSuggestedName("Ada")).toBe(true);
    expect(validateSuggestedName("a".repeat(121))).toBe(false);
    expect(validateInvitePassword("short")).toMatch(/at least 16/);
    expect(validateInvitePassword("a".repeat(16))).toBe("");
  });

  it("resolves the earliest user as the installation owner", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "owner-a" }]);
    const orderBy = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ orderBy }));
    const db = { select: vi.fn(() => ({ from })) };
    await expect(resolveInstallationOwner(db as never)).resolves.toEqual({ id: "owner-a" });
    expect(orderBy).toHaveBeenCalledOnce();
  });
});
