import { describe, expect, it } from "vitest";
import { groupJoinRequestExpiresAt, GROUP_JOIN_REQUEST_TTL, isGroupJoinRequestExpired } from "./group-join-requests";

describe("Group join requests", () => {
  it("uses a seven-day inclusive expiry boundary", () => {
    const createdAt = new Date("2026-08-25T00:00:00.000Z");
    const expiresAt = groupJoinRequestExpiresAt(createdAt);
    expect(GROUP_JOIN_REQUEST_TTL).toBe(7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(isGroupJoinRequestExpired(expiresAt, new Date("2026-08-31T23:59:59.999Z"))).toBe(false);
    expect(isGroupJoinRequestExpired(expiresAt, expiresAt)).toBe(true);
  });
});
