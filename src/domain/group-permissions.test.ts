import { describe, expect, it } from "vitest";
import { groupAccessForRole, isGroupRole } from "./group-permissions";

describe("group permissions", () => {
  it.each([
    ["owner", true, true, true, true],
    ["admin", false, true, true, false],
    ["member", false, false, false, false],
  ] as const)("keeps the %s boundary centralized", (role, isOwner, canManageGroup, canManageParticipants, canDelete) => {
    expect(groupAccessForRole(role)).toMatchObject({ isOwner, canManageGroup, canManageParticipants, canDelete });
  });

  it("rejects unsupported roles", () => {
    expect(isGroupRole("treasurer")).toBe(false);
    expect(isGroupRole("admin")).toBe(true);
  });
});
