import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppLayout from "./layout";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));

describe("authenticated app shell", () => {
  it("delegates unauthenticated access to the session guard", async () => {
    mocks.requireSession.mockRejectedValue(new Error("redirect:/login"));
    await expect(AppLayout({ children: <p>Private content</p> })).rejects.toThrow("redirect:/login");
  });

  it("renders owner identity and only the finished destinations", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a", name: "Wildan", email: "owner@example.com" } });
    render(await AppLayout({ children: <p>Private content</p> }));

    expect(screen.getByText("Zplit")).toBeInTheDocument();
    expect(screen.getByText("PRIVATE LEDGER")).toBeInTheDocument();
    expect(screen.getByText("Wildan")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Ledger navigation" }).querySelectorAll("a")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Index" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: "Friends" })).toHaveAttribute("href", "/app/friends");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/balance|chart|dashboard|outing|expense|repayment/i);
  });
});
