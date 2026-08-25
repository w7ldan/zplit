import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));

import { searchUsernameDirectory, USERNAME_DIRECTORY_LIMIT } from "./user-directory";

function database(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockResolvedValue(rows);
  mocks.getDatabase.mockReturnValue({ select: vi.fn(() => builder) });
  return builder;
}

describe("username directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "requester" } });
  });

  it("requires an authenticated requester", async () => {
    mocks.requireSession.mockRejectedValue(new Error("unauthenticated"));
    await expect(searchUsernameDirectory("alice")).rejects.toThrow("unauthenticated");
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("searches only username prefixes and returns the bounded minimum projection", async () => {
    const builder = database([
      { id: "user-a", username: "alice.tan", displayName: "Alice Tan" },
      { id: "legacy", username: null, displayName: "Legacy" },
    ]);
    await expect(searchUsernameDirectory("@ALICE")).resolves.toEqual([{ id: "user-a", username: "alice.tan", displayName: "Alice Tan" }]);
    expect(builder.limit).toHaveBeenCalledWith(USERNAME_DIRECTORY_LIMIT);
  });

  it("does not treat email-shaped input as a directory query", async () => {
    const builder = database([]);
    await expect(searchUsernameDirectory("alice@example.com")).resolves.toEqual([]);
    expect(builder.limit).not.toHaveBeenCalled();
  });
});
