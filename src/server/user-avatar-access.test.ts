import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserAvatar: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireGroupAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./user-avatars", () => ({ getUserAvatar: mocks.getUserAvatar }));
vi.mock("./organizations", () => ({
  OrganizationError: class OrganizationError extends Error {},
  requireOrganizationAccess: mocks.requireOrganizationAccess,
}));
vi.mock("./groups", () => ({
  GroupError: class GroupError extends Error {},
  requireGroupAccess: mocks.requireGroupAccess,
}));

import { canReadUserAvatar, getUserAvatarForViewer, getUserAvatarMetadataForViewer } from "./user-avatar-access";

function queryBuilder(result: unknown) {
  const query = {} as Record<string, unknown> & { then: Promise<unknown>["then"] };
  for (const method of ["from", "innerJoin", "where", "limit"]) query[method] = vi.fn(() => query);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function database(selects: unknown[][]) {
  return { select: vi.fn(() => queryBuilder(selects.shift() ?? [])) };
}

describe("user avatar read access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationAccess.mockResolvedValue({ require: vi.fn() });
    mocks.requireGroupAccess.mockResolvedValue({});
  });

  it("allows self reads and delegates subject retrieval", async () => {
    const avatar = { sha256: "a".repeat(64) };
    mocks.getUserAvatar.mockResolvedValue(avatar);
    expect(canReadUserAvatar("user-a", "user-a")).toBe(true);
    await expect(getUserAvatarForViewer({} as never, "user-a", "user-a")).resolves.toBe(avatar);
    expect(mocks.getUserAvatar).toHaveBeenCalledWith({}, "user-a");
  });

  it("allows users sharing an Organization or active Group", async () => {
    const avatar = { sha256: "a".repeat(64) };
    mocks.getUserAvatar.mockResolvedValue(avatar);

    await expect(getUserAvatarForViewer(database([[{ organizationId: "org-a" }], []]) as never, "user-a", "user-b")).resolves.toBe(avatar);
    await expect(getUserAvatarForViewer(database([[], [{ groupId: "group-a" }]]) as never, "user-a", "user-b")).resolves.toBe(avatar);
    expect(mocks.requireOrganizationAccess).toHaveBeenCalledWith(expect.anything(), "org-a", "user-a");
    expect(mocks.requireGroupAccess).toHaveBeenCalledWith(expect.anything(), "group-a", "user-a");
  });

  it("denies unrelated, external, and removed-context reads before retrieval", async () => {
    expect(canReadUserAvatar("user-a", "user-b")).toBe(false);
    await expect(getUserAvatarForViewer(database([[], []]) as never, "user-a", "user-b")).resolves.toBeNull();
    await expect(getUserAvatarForViewer(database([[], []]) as never, "user-a", "external-user")).resolves.toBeNull();
    expect(mocks.getUserAvatar).not.toHaveBeenCalled();
  });

  it("returns only current registered members' metadata in one scoped batch", async () => {
    const db = database([[{ userId: "user-b", sha256: "b".repeat(64) }]]) as never;
    const metadata = await getUserAvatarMetadataForViewer(db, "user-a", ["user-a", "user-b", "user-b"], { type: "group", id: "group-a" });

    expect(metadata).toEqual(new Map([["user-b", { sha256: "b".repeat(64) }]]));
    expect(mocks.requireGroupAccess).toHaveBeenCalledWith(db, "group-a", "user-a");
    expect((db as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledOnce();
  });
});
