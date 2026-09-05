import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getGroupForMember: vi.fn(), hasFinancialHistory: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ getGroupForMember: mocks.getGroupForMember, hasFinancialHistory: mocks.hasFinancialHistory }));
vi.mock("@/components/groups/group-detail", () => ({ GroupProfile: () => <div>Group profile</div> }));
vi.mock("../../actions", () => ({ deleteGroupAction: vi.fn(), archiveGroupAction: vi.fn(), restoreGroupAction: vi.fn(), updateGroupAction: vi.fn() }));

import GroupSettingsPage from "./page";
import { archiveGroupAction, deleteGroupAction } from "../../actions";

describe("Group settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.getGroupForMember.mockResolvedValue({ id: "group-a", name: "Trip", description: null, avatar: null, archivedAt: null, canManageGroup: true, canDelete: true });
    mocks.hasFinancialHistory.mockResolvedValue(false);
  });

  it("explains protected financial history and removes the stale Stage 12 copy", async () => {
    render(await GroupSettingsPage({ params: Promise.resolve({ groupId: "group-a" }), searchParams: Promise.resolve({ error: "financial_history" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("This Group cannot be deleted because it has financial history. The records remain untouched.");
    expect(screen.getByText(/Financial history is protected and blocks deletion/)).toBeInTheDocument();
    expect(screen.queryByText("There is no Group financial history in this stage.")).not.toBeInTheDocument();
  });

  it("confirms group deletion with the group name before calling the action", async () => {
    mocks.getGroupForMember.mockResolvedValue({
      id: "group-a",
      name: "Bandung Trip",
      description: null,
      avatar: null,
      archivedAt: null,
      canManageGroup: true,
      canDelete: true,
    });
    mocks.hasFinancialHistory.mockResolvedValue(false);
    render(
      await GroupSettingsPage({
        params: Promise.resolve({ groupId: "group-a" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole("button", { name: "Delete group" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(vi.mocked(deleteGroupAction)).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete group?" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Bandung Trip/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(deleteGroupAction)).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows archive instead of permanent deletion when financial history exists", async () => {
    mocks.hasFinancialHistory.mockResolvedValue(true);
    render(
      await GroupSettingsPage({
        params: Promise.resolve({ groupId: "group-a" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByRole("button", { name: "Delete group" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive group" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    expect(vi.mocked(archiveGroupAction)).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Archive group?" })).toBeInTheDocument();
    expect(within(dialog).getByText(/archived instead of permanently deleted/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(vi.mocked(archiveGroupAction)).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows restore for an archived group", async () => {
    mocks.getGroupForMember.mockResolvedValue({
      id: "group-a",
      name: "Trip",
      description: null,
      avatar: null,
      archivedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      canManageGroup: true,
      canDelete: true,
    });
    render(
      await GroupSettingsPage({
        params: Promise.resolve({ groupId: "group-a" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete group" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive group" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore group" })).toBeInTheDocument();
  });
});
