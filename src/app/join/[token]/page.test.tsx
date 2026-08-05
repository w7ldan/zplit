import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JoinPage, { metadata } from "./page";

const mocks = vi.hoisted(() => ({ findUsableInvitation: vi.fn(), getSession: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth/invitations", () => ({ findUsableInvitation: mocks.findUsableInvitation }));
vi.mock("@/db/client", () => ({ getDatabase: vi.fn(() => "database") }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/components/auth/invite-signup-form", () => ({ InviteSignupForm: ({ email }: { email: string }) => <form aria-label={`Create account for ${email}`} /> }));

describe("/join/[token]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the invite account form for a usable token", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.findUsableInvitation.mockResolvedValue({ email: "person@example.com", suggestedName: "Ada" });
    render(await JoinPage({ params: Promise.resolve({ token: "a".repeat(64) }) }));

    expect(screen.getByRole("heading", { level: 1, name: "Make it yours." })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create account for person@example.com" })).toBeInTheDocument();
  });

  it("does not expose account creation for an unavailable token", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.findUsableInvitation.mockResolvedValue(null);
    render(await JoinPage({ params: Promise.resolve({ token: "expired" }) }));

    expect(screen.getByRole("heading", { level: 1, name: "This invitation is unavailable." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to login" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("redirects authenticated visitors before checking the token", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    await expect(JoinPage({ params: Promise.resolve({ token: "bad" }) })).rejects.toThrow("redirect:/app");
    expect(mocks.findUsableInvitation).not.toHaveBeenCalled();
  });

  it("marks invitation links noindex and nofollow", () => {
    expect(metadata).toMatchObject({
      title: "Join Zplit",
      description: "Create your private Zplit ledger through a secure invitation.",
      robots: { index: false, follow: false },
      referrer: "no-referrer",
      openGraph: { title: "Join Zplit", description: "Create your private Zplit ledger through a secure invitation." },
      twitter: { card: "summary_large_image", title: "Join Zplit", description: "Create your private Zplit ledger through a secure invitation." },
    });
    expect(JSON.stringify(metadata)).not.toMatch(/person@example\.com|Ada|expired|token/i);
  });
});
