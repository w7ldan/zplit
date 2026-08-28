import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), getGroupForMember: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ getGroupForMember: mocks.getGroupForMember }));
vi.mock("@/components/groups/group-detail", () => ({ GroupProfile: () => <div>Group profile</div> }));
vi.mock("../../actions", () => ({ deleteGroupAction: vi.fn(), updateGroupAction: vi.fn() }));

import GroupSettingsPage from "./page";

describe("Group settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.getGroupForMember.mockResolvedValue({ id: "group-a", name: "Trip", description: null, avatar: null, canManageGroup: true, canDelete: true });
  });

  it("explains protected financial history and removes the stale Stage 12 copy", async () => {
    render(await GroupSettingsPage({ params: Promise.resolve({ groupId: "group-a" }), searchParams: Promise.resolve({ error: "financial_history" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("This Group cannot be deleted because it has financial history. The records remain untouched.");
    expect(screen.getByText(/Financial history is protected and blocks deletion/)).toBeInTheDocument();
    expect(screen.queryByText("There is no Group financial history in this stage.")).not.toBeInTheDocument();
  });
});
