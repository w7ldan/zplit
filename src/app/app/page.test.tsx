import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppPage from "./page";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/auth/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

describe("/app", () => {
  it("redirects unauthenticated visitors to login", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(AppPage()).rejects.toThrow("redirect:/login");
  });

  it("renders the authenticated owner identity and sign-out action", async () => {
    mocks.getSession.mockResolvedValue({ user: { name: "Wildan", email: "owner@idr.wildan.lol" } });
    render(await AppPage());

    expect(screen.getByText("06 / LEDGER ACCESS")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ledger access established." })).toBeInTheDocument();
    expect(screen.getByText("Wildan")).toBeInTheDocument();
    expect(screen.getByText("owner@idr.wildan.lol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/balance|transaction count|chart|dashboard/i);
  });
});
