import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JoinPage from "./page";

const mocks = vi.hoisted(() => ({ findUsableInvitation: vi.fn() }));

vi.mock("@/auth/invitations", () => ({ findUsableInvitation: mocks.findUsableInvitation }));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn(() => "database") }));
vi.mock("@/components/auth/invite-signup-form", () => ({ InviteSignupForm: ({ email }: { email: string }) => <form aria-label={`Create account for ${email}`} /> }));

describe("/join/[token]", () => {
  it("renders the invite account form for a usable token", async () => {
    mocks.findUsableInvitation.mockResolvedValue({ email: "person@example.com", suggestedName: "Ada" });
    render(await JoinPage({ params: Promise.resolve({ token: "a".repeat(64) }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Make it yours." })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create account for person@example.com" })).toBeInTheDocument();
  });

  it("does not expose account creation for an unavailable token", async () => {
    mocks.findUsableInvitation.mockResolvedValue(null);
    render(await JoinPage({ params: Promise.resolve({ token: "expired" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Invitation unavailable." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to login" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
