import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getDatabase: vi.fn(), listOrganizations: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ listOrganizations: mocks.listOrganizations }));

import OrganizationsPage from "./page";

describe("/app/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.listOrganizations.mockResolvedValue([]);
  });

  it("renders the empty organization shell", async () => {
    render(await OrganizationsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Your organizations" })).toBeInTheDocument();
    expect(screen.getByText("No organizations yet.")).toBeInTheDocument();
    expect(document.querySelector(".organization-grid")).not.toBeInTheDocument();
  });

  it("renders membership-backed compact cards", async () => {
    mocks.listOrganizations.mockResolvedValue([{ id: "org-a", name: "Studio", description: null, role: "owner", memberCount: 2, avatar: null }]);
    render(await OrganizationsPage());
    expect(screen.getByRole("link", { name: /Studio/ })).toHaveAttribute("href", "/app/organizations/org-a");
    expect(screen.getByText(/Owner · 2 members/)).toBeInTheDocument();
    expect(document.querySelectorAll(".organization-grid")).toHaveLength(1);
  });
});
