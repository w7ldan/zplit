import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/history", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

describe("AppShell", () => {
  it("keeps five primary destinations and puts History in the account menu", () => {
    render(<AppShell user={{ name: "Wildan", email: "owner@example.com" }}><p>Private</p></AppShell>);
    const primary = screen.getByRole("navigation", { name: "Ledger navigation" });
    expect(within(primary).getAllByRole("link")).toHaveLength(5);
    expect(within(primary).queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/app/history");
    expect(screen.getByRole("link", { name: "Exports" })).toHaveAttribute("href", "/app/exports");
  });
});
