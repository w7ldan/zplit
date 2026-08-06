import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/history", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

let frameCallback: FrameRequestCallback | undefined;

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  frameCallback = undefined;
});

describe("AppShell", () => {
  it("keeps five primary destinations and puts History in the account menu", () => {
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const primary = screen.getByRole("navigation", { name: "Ledger navigation" });
    const mobile = screen.getByRole("navigation", { name: "Mobile ledger navigation" });
    expect(document.querySelector(".app-shell__brand")).toBeInTheDocument();
    expect(document.querySelector(".app-shell__actions")).toBeInTheDocument();
    expect(within(primary).getAllByRole("link")).toHaveLength(5);
    expect(within(mobile).getAllByRole("link")).toHaveLength(5);
    expect(within(primary).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/app",
      "/app/friends",
      "/app/outings",
      "/app/expenses",
      "/app/repayments",
    ]);
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute("href", "/app/expenses?create=1");
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
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const header = screen.getByRole("banner");
    const panel = header.querySelector<HTMLElement>(".app-shell__header-layout")!;
    expect(header).not.toHaveClass("header-shell--detached");
    expect(panel).not.toHaveClass("header-shell__panel--detached");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 40 });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frameCallback?.(1));
    expect(header).toHaveClass("header-shell--detached");
    expect(panel).toHaveClass("header-shell__panel--detached");
  });

  it("removes detached classes when returning above the scroll threshold", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const header = screen.getByRole("banner");
    const panel = header.querySelector<HTMLElement>(".app-shell__header-layout")!;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 40 });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frameCallback?.(1));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    act(() => window.dispatchEvent(new Event("scroll")));
    act(() => frameCallback?.(2));
    expect(header).not.toHaveClass("header-shell--detached");
    expect(panel).not.toHaveClass("header-shell__panel--detached");
  });

  it("keeps the painted panel inside the transparent header wrapper", () => {
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const header = screen.getByRole("banner");
    const panel = header.querySelector<HTMLElement>(".app-shell__header-layout");
    expect(panel).toBeInTheDocument();
    expect(header).toContainElement(panel);
    expect(header).not.toHaveClass("header-shell--detached");
    expect(panel).not.toHaveClass("header-shell__panel--detached");
    expect(panel).toHaveAttribute("data-detached", "false");
  });

  it("mounts the authenticated header detached after restored scroll", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallback = callback; return 1; });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 48 });
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    expect(screen.getByRole("banner")).toHaveClass("header-shell--detached");
  });
});
