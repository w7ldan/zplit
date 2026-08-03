import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock("@/auth/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signInEmail.mockResolvedValue({ data: {}, error: null });
  });

  it("normalizes email, preserves password, and enters the ledger", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "  OWNER@EXAMPLE.COM " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "  Keep spaces exactly  " } });
    fireEvent.click(screen.getByLabelText("Keep me signed in"));
    fireEvent.submit(screen.getByRole("button", { name: "Enter the ledger" }));

    await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "  Keep spaces exactly  ",
      rememberMe: true,
    }));
    expect(mocks.replace).toHaveBeenCalledWith("/app");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("shows one generic error and prevents repeated submission", async () => {
    let resolveSignIn: (value: unknown) => void = () => {};
    mocks.signInEmail.mockReturnValue(new Promise((resolve) => {
      resolveSignIn = resolve;
    }));
    render(<LoginForm />);
    const form = screen.getByRole("button", { name: "Enter the ledger" }).closest("form");
    if (!form) throw new Error("login form is missing");

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.signInEmail).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Entering…" })).toBeDisabled();
    resolveSignIn({ data: null, error: { message: "raw server error" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to sign in with those credentials."));
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw server error");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
