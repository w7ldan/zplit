import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), listGroups: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/groups", () => ({ listGroups: mocks.listGroups }));
import PersonalPage from "./page";

describe("/app/personal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.listGroups.mockResolvedValue([]);
  });

  it("keeps the existing ledger destinations under Personal and exposes the empty Groups state", async () => {
    render(await PersonalPage());

    expect(screen.getByRole("heading", { level: 1, name: "Personal" })).toBeInTheDocument();
    for (const [name, href] of [["Friends", "/app/friends"], ["Outings", "/app/outings"], ["Expenses", "/app/expenses"], ["Repayments", "/app/repayments"]]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("heading", { level: 2, name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("No groups yet.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/organization record|member count|permission/i);
  });
});
