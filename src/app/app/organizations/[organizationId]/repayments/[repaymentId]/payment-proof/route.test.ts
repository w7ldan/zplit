import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeOrganizationError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return {
    FakeOrganizationError,
    getSession: vi.fn(),
    headers: vi.fn(),
    getDatabase: vi.fn(),
    requireOrganizationLedgerAccess: vi.fn(),
    createRepaymentPaymentProof: vi.fn(),
    replaceRepaymentPaymentProof: vi.fn(),
  };
});

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ OrganizationError: mocks.FakeOrganizationError, requireOrganizationLedgerAccess: mocks.requireOrganizationLedgerAccess }));
vi.mock("@/server/repayment-payment-proofs", () => ({
  createRepaymentPaymentProof: mocks.createRepaymentPaymentProof,
  replaceRepaymentPaymentProof: mocks.replaceRepaymentPaymentProof,
  PAYMENT_PROOF_ALREADY_ATTACHED_MESSAGE: "This repayment already has a payment proof.",
  RepaymentPaymentProofAlreadyAttachedError: class RepaymentPaymentProofAlreadyAttachedError extends Error {},
  RepaymentPaymentProofUnavailableError: class RepaymentPaymentProofUnavailableError extends Error {},
}));

import { POST } from "./route";

function uploadRequest() {
  const form = new FormData();
  form.append("paymentProof", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0x01])], "proof.jpg", { type: "image/jpeg" }));
  const request = new Request("https://zplit.test/app/organizations/org-a/repayments/repayment-a/payment-proof", {
    method: "POST",
    headers: { Origin: "https://zplit.test", "Content-Length": "100000" },
  });
  Object.defineProperty(request, "formData", { value: async () => form });
  return request;
}

describe("Organization payment proof upload authorization", () => {
  it("returns forbidden when edit capability is revoked before the attachment transaction", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "actor-a" } });
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getDatabase.mockReturnValue("database");
    mocks.requireOrganizationLedgerAccess.mockResolvedValue({ ledgerScopeId: "scope-a" });
    mocks.createRepaymentPaymentProof.mockRejectedValue(new mocks.FakeOrganizationError("forbidden"));

    const response = await POST(uploadRequest(), { params: Promise.resolve({ organizationId: "org-a", repaymentId: "repayment-a" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You do not have permission to edit this Organization repayment." });
    expect(mocks.createRepaymentPaymentProof).toHaveBeenCalledWith(
      "database",
      { ledgerScopeId: "scope-a", organizationId: "org-a", userId: "actor-a", requiredCapability: "repayments.edit" },
      "repayment-a",
      expect.objectContaining({ mediaType: "image/jpeg" }),
    );
  });
});
