import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DebtorSharePage, { dynamic, metadata, revalidate } from "./page";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), getDatabase: vi.fn(), unstableNoStore: vi.fn() }));

vi.mock("@/server/debtor-share-links", async () => {
  const actual = await vi.importActual<typeof import("@/server/debtor-share-links")>("@/server/debtor-share-links");
  return { ...actual, resolveDebtorShareLink: mocks.resolve };
});
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("next/cache", () => ({ unstable_noStore: mocks.unstableNoStore }));

describe("/share/[token]", () => {
  it("renders the statement without authentication or private metadata", async () => {
    mocks.resolve.mockResolvedValue({
      statement: {
        friendName: "Ada",
        generatedAt: new Date("2026-08-04T00:00:00Z"),
        assignedAmount: 10_000,
        repaidAmount: 2_000,
        outstandingAmount: 8_000,
        items: [],
      },
      expiresAt: new Date("2026-08-11T00:00:00Z"),
    });
    render(await DebtorSharePage({ params: Promise.resolve({ token: "11111111-1111-4111-8111-111111111111" }) }));
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Rp 8.000")).toBeInTheDocument();
    expect(screen.queryByText(/owner@example.com|owner name|phone number|private notes|log in/i)).not.toBeInTheDocument();
  });

  it("forwards independent history pages to the server resolver", async () => {
    mocks.resolve.mockResolvedValue(null);
    const token = "11111111-1111-4111-8111-111111111111";
    await DebtorSharePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({ expensePage: "2", repaymentPage: "3" }),
    });
    expect(mocks.resolve).toHaveBeenLastCalledWith(mocks.getDatabase(), token, expect.any(Date), { expensePage: "2", repaymentPage: "3" });
  });

  it.each(["malformed", "missing", "expired", "revoked"])("uses one generic unavailable state for %s links", async (token) => {
    mocks.resolve.mockResolvedValue(null);
    render(await DebtorSharePage({ params: Promise.resolve({ token }) }));
    expect(screen.getByText("This balance link is unavailable.")).toBeInTheDocument();
  });

  it("declares noindex, nofollow, no-referrer, and dynamic no-store behavior", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
    expect(metadata).toMatchObject({
      title: "Private Zplit balance",
      description: "A private, read-only Zplit balance is ready to view.",
      robots: { index: false, follow: false },
      referrer: "no-referrer",
      openGraph: { title: "Private Zplit balance", description: "A private, read-only Zplit balance is ready to view." },
      twitter: { card: "summary_large_image", title: "Private Zplit balance", description: "A private, read-only Zplit balance is ready to view." },
    });
    expect(JSON.stringify(metadata)).not.toMatch(/Ada|owner|Rp|42\.500|token|receipt/i);
    mocks.resolve.mockResolvedValue(null);
    await DebtorSharePage({ params: Promise.resolve({ token: "malformed" }) });
    expect(mocks.unstableNoStore).toHaveBeenCalled();
  });
});
