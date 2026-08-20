import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
}));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/repayment-payment-proofs", () => ({
  createRepaymentPaymentProof: mocks.create,
  replaceRepaymentPaymentProof: mocks.replace,
  PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE: "This repayment already has a payment proof.",
  RepaymentPaymentProofAlreadyAttachedError: class RepaymentPaymentProofAlreadyAttachedError extends Error {},
  RepaymentPaymentProofUnavailableError: class RepaymentPaymentProofUnavailableError extends Error {},
}));

import { POST, PUT } from "./route";

const metadata = {
  id: "33333333-3333-4333-8333-333333333333",
  originalFilename: "transfer.jpg",
  mediaType: "image/jpeg",
  byteSize: 5,
  createdAt: new Date("2026-08-20T00:00:00.000Z"),
};

function request(file = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])], "transfer.jpg", { type: "image/jpeg" }), fields: Record<string, string | File> = { paymentProof: file }, requestHeaders: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const nextRequest = new Request("https://zplit.test/app/repayments/22222222-2222-4222-8222-222222222222/payment-proof", {
    method: "POST",
    headers: { Origin: "https://zplit.test", "Content-Length": "100000", ...requestHeaders },
  });
  Object.defineProperty(nextRequest, "formData", { value: async () => form });
  return nextRequest;
}

const params = { params: Promise.resolve({ repaymentId: "repayment-a" }) };

describe("payment proof upload route", () => {
  it("requires a session, same origin, and bounded requests", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(401);
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    expect((await POST(request(undefined, undefined, { Origin: "" }), params)).status).toBe(403);
    expect((await POST(request(undefined, undefined, { "Content-Length": String(6 * 1024 * 1024 + 1) }), params)).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("validates signed images and binds add/replace to the session owner", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.create.mockResolvedValue(metadata);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect((await response.json()).paymentProof).toMatchObject({ ...metadata, createdAt: metadata.createdAt.toISOString() });
    expect(mocks.create).toHaveBeenCalledWith("database", "owner-a", "repayment-a", expect.objectContaining({ mediaType: "image/jpeg", byteSize: 5 }));

    mocks.replace.mockResolvedValue({ ...metadata, originalFilename: "new.jpg" });
    const replacement = await PUT(request(new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])], "new.jpg", { type: "image/jpeg" })), params);
    expect(replacement.status).toBe(200);
    expect(mocks.replace).toHaveBeenCalledWith("database", "owner-a", "repayment-a", expect.objectContaining({ originalFilename: "new.jpg" }));

    const invalid = await POST(request(new File([Uint8Array.from([1, 2, 3])], "bad.png", { type: "image/png" })), params);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("Payment proof files must be JPEG, PNG, or WebP images.");
    const oversized = await POST(request(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })), params);
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error).toBe("Payment proof files must be 5 MiB or smaller.");
  });
});
