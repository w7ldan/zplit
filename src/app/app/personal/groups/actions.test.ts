import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestGroupError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { requireSession: vi.fn(), getDatabase: vi.fn(), deleteGroup: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }), GroupError: TestGroupError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ deleteGroup: mocks.deleteGroup, GroupError: mocks.GroupError }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { deleteGroupAction } from "./actions";

describe("Group actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
  });

  it("returns a clear Settings result when financial history protects a Group", async () => {
    mocks.deleteGroup.mockRejectedValue(new mocks.GroupError("financial_history"));

    await expect(deleteGroupAction("group-a")).rejects.toThrow("redirect:/app/personal/groups/group-a/settings?error=financial_history");
  });

  it("redirects a deleted Group to the Group list", async () => {
    mocks.deleteGroup.mockResolvedValue(true);

    await expect(deleteGroupAction("group-a")).rejects.toThrow("redirect:/app/personal/groups");
  });
});
