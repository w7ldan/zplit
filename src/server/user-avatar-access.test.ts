import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserAvatar: vi.fn() }));

vi.mock("./user-avatars", () => ({ getUserAvatar: mocks.getUserAvatar }));

import { canReadUserAvatar, getUserAvatarForViewer } from "./user-avatar-access";

describe("user avatar read access", () => {
  it("allows the current self-only policy and delegates subject retrieval", async () => {
    const avatar = { sha256: "a".repeat(64) };
    mocks.getUserAvatar.mockResolvedValue(avatar);
    expect(canReadUserAvatar("user-a", "user-a")).toBe(true);
    await expect(getUserAvatarForViewer({} as never, "user-a", "user-a")).resolves.toBe(avatar);
    expect(mocks.getUserAvatar).toHaveBeenCalledWith({}, "user-a");
  });

  it("denies cross-user reads before retrieval under the current policy", async () => {
    mocks.getUserAvatar.mockClear();
    expect(canReadUserAvatar("user-a", "user-b")).toBe(false);
    await expect(getUserAvatarForViewer({} as never, "user-a", "user-b")).resolves.toBeNull();
    expect(mocks.getUserAvatar).not.toHaveBeenCalled();
  });
});
