import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/history", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

afterEach(() => vi.unstubAllGlobals());

describe("AppShell", () => {
  it("keeps five primary destinations and puts History in the account menu", () => {
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const primary = screen.getByRole("navigation", { name: "Ledger navigation" });
    expect(within(primary).getAllByRole("link")).toHaveLength(5);
    expect(within(primary).queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/app/history");
    expect(screen.getByRole("link", { name: "Exports" })).toHaveAttribute("href", "/app/exports");
  });

  it("shows only the user name in the closed account control and keeps its menu", () => {
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const summary = document.querySelector(".account-menu summary")!;
    expect(summary).toHaveAttribute("aria-label", "Open account menu for Wildan");
    expect(summary).toHaveTextContent("Wildan");
    expect(summary).not.toHaveTextContent("Account");
    fireEvent.click(summary);
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("uses the shared detached-header behavior", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(1); return 1; });
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const header = screen.getByRole("banner");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 40 });
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(header).toHaveClass("app-shell__header--detached");
  });
});
