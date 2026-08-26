import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), listGroups: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ listGroups: mocks.listGroups }));

import GroupsPage from "./page";

describe("/app/personal/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.listGroups.mockResolvedValue([]);
  });

  it("renders an honest empty state", async () => {
    render(await GroupsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Balances|Settlements/ })).not.toBeInTheDocument();
  });

  it("renders membership-backed participant counts", async () => {
    mocks.listGroups.mockResolvedValue([{ id: "group-a", name: "Bandung Trip", description: null, role: "owner", participantCount: 4, avatar: null }]);
    render(await GroupsPage());
    expect(screen.getByRole("link", { name: /Bandung Trip/ })).toHaveAttribute("href", "/app/personal/groups/group-a");
    expect(screen.getByText("Owner · 4 participants")).toBeInTheDocument();
  });
});
