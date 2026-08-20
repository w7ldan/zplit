import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/repayment-payment-proofs", () => ({
  getRepaymentPaymentProof: mocks.get,
  deleteRepaymentPaymentProof: mocks.remove,
  PAYMENT_PROOF_UNAVAILABLE_MESSAGE: "This repayment or payment proof is no longer available.",
  PAYMENT_PROOF_READ_HEADERS: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  },
}));

import { DELETE, GET } from "./route";

const params = { params: Promise.resolve({ repaymentId: "repayment-a", proofId: "33333333-3333-4333-8333-333333333333" }) };

describe("payment proof read/delete route", () => {
  it("returns owner-scoped bytes with private headers and a fixed payment-proof filename", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new Request("https://zplit.test/app"), params)).status).toBe(401);
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.get.mockResolvedValue({ id: params.params instanceof Promise ? "33333333-3333-4333-8333-333333333333" : "", mediaType: "image/png", byteSize: bytes.length, content: bytes });
    const response = await GET(new Request("https://zplit.test/app/repayments/repayment-a/payment-proof/proof-a"), params);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="payment-proof-33333333-3333-4333-8333-333333333333.png"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith("database", "owner-a", "repayment-a", "33333333-3333-4333-8333-333333333333");
  });

  it("does not reveal foreign proofs and requires same-origin removal", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-b" } });
    mocks.get.mockResolvedValue(null);
    expect((await GET(new Request("https://zplit.test/app"), params)).status).toBe(404);
    expect((await DELETE(new Request("https://zplit.test/app", { method: "DELETE" }), params)).status).toBe(403);
    mocks.remove.mockResolvedValue(true);
    const deleted = await DELETE(new Request("https://zplit.test/app", { method: "DELETE", headers: { Origin: "https://zplit.test" } }), params);
    expect(deleted.status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("database", "owner-b", "repayment-a", "33333333-3333-4333-8333-333333333333");
  });
});
