import { describe, expect, it } from "vitest";
import { isOrganizationInvitationExpired, ORGANIZATION_INVITATION_TTL, organizationInvitationExpiresAt } from "./organization-invitations";

describe("Organization invitations", () => {
  it("uses one seven-day expiration policy with an inclusive boundary", () => {
    const createdAt = new Date("2026-08-25T00:00:00.000Z");
    const expiresAt = organizationInvitationExpiresAt(createdAt);
    expect(ORGANIZATION_INVITATION_TTL).toBe(7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(isOrganizationInvitationExpired(expiresAt, new Date("2026-08-31T23:59:59.999Z"))).toBe(false);
    expect(isOrganizationInvitationExpired(expiresAt, expiresAt)).toBe(true);
  });
});
