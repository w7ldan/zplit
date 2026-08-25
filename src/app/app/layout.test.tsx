import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppLayout from "./layout";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  resolveInstallationOwner: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/auth/invitations", () => ({ resolveInstallationOwner: mocks.resolveInstallationOwner }));
vi.mock("@/server/notifications", () => ({ getUnreadNotificationCountForUser: mocks.getUnreadNotificationCount }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }), usePathname: () => "/app/expenses/expense-a" }));

describe("authenticated app shell", () => {
  it("delegates unauthenticated access to the session guard", async () => {
    mocks.requireSession.mockRejectedValue(new Error("redirect:/login"));
    await expect(AppLayout({ children: <p>Private content</p> })).rejects.toThrow("redirect:/login");
  });

  it("renders active navigation, account menu, and the stable expense action", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a", name: "Wildan", email: "owner@example.com" } });
    mocks.resolveInstallationOwner.mockResolvedValue({ id: "user-a" });
    mocks.getUnreadNotificationCount.mockResolvedValue(0);
    render(await AppLayout({ children: <p>Private content</p> }));

    expect(screen.getByText("Zplit")).toBeInTheDocument();
    expect(screen.getByText("PRIVATE LEDGER")).toBeInTheDocument();
    expect(screen.getAllByText("Wildan").length).toBeGreaterThan(0);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Ledger navigation" });
    expect(navigation.querySelectorAll("a")).toHaveLength(5);
    expect(within(navigation).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/app");
    expect(within(navigation).getByRole("link", { name: "Friends" })).toHaveAttribute("href", "/app/friends");
    expect(within(navigation).getByRole("link", { name: "Outings" })).toHaveAttribute("href", "/app/outings");
    expect(within(navigation).getByRole("link", { name: "Expenses" })).toHaveAttribute("href", "/app/expenses");
    expect(within(navigation).getByRole("link", { name: "Repayments" })).toHaveAttribute("href", "/app/repayments");
    expect(screen.getByRole("link", { name: "Invitations" })).toHaveAttribute("href", "/app/invites");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/app/history");
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/app/expenses?create=1");
    expect(within(navigation).getByRole("link", { name: "Expenses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Mobile ledger navigation" }).querySelectorAll("a")).toHaveLength(5);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/chart|dashboard|share/i);
  });

  it("does not expose invitation management to a non-owner", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-b", name: "Ada", email: "ada@example.com" } });
    mocks.resolveInstallationOwner.mockResolvedValue({ id: "user-a" });
    mocks.getUnreadNotificationCount.mockResolvedValue(0);
    render(await AppLayout({ children: <p>Private content</p> }));
    expect(screen.queryByRole("link", { name: "Invitations" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Ledger navigation" }).querySelectorAll("a")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/app/history");
  });
});
