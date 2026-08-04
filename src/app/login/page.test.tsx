import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

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
vi.mock("@/auth/auth-client", () => ({ authClient: { signIn: { email: vi.fn() } } }));

describe("/login", () => {
  it("renders a compact access surface without public account actions", async () => {
    mocks.getSession.mockResolvedValue(null);
    render(await LoginPage());

    expect(screen.getByRole("link", { name: "Zplit" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back." })).toBeInTheDocument();
    expect(screen.getByText(/shared-expense record/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Keep me signed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter the ledger" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Zplit/ })).toHaveAttribute("href", "/");
    expect(document.body).not.toHaveTextContent(/register|registration|forgot|reset|social|single owner|operator/i);
  });

  it("redirects an authenticated visitor to the application", async () => {
    mocks.getSession.mockResolvedValue({ user: { name: "Wildan", email: "owner@example.com" } });
    await expect(LoginPage()).rejects.toThrow("redirect:/app");
  });
});
