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
    createExpenseReceipt: vi.fn(),
  };
});

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/organizations", () => ({ OrganizationError: mocks.FakeOrganizationError, requireOrganizationLedgerAccess: mocks.requireOrganizationLedgerAccess }));
vi.mock("@/server/expense-receipts", () => ({
  createExpenseReceipt: mocks.createExpenseReceipt,
  ExpenseReceiptCountError: class ExpenseReceiptCountError extends Error {},
  ExpenseReceiptDuplicateError: class ExpenseReceiptDuplicateError extends Error {},
  ExpenseReceiptTotalSizeError: class ExpenseReceiptTotalSizeError extends Error {},
  ExpenseReceiptUnavailableError: class ExpenseReceiptUnavailableError extends Error {},
}));

import { POST } from "./route";

function uploadRequest() {
  const form = new FormData();
  form.append("receipt", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0x01])], "receipt.jpg", { type: "image/jpeg" }));
  const request = new Request("https://zplit.test/app/organizations/org-a/expenses/expense-a/receipts", {
    method: "POST",
    headers: { Origin: "https://zplit.test", "Content-Length": "100000" },
  });
  Object.defineProperty(request, "formData", { value: async () => form });
  return request;
}

describe("Organization receipt upload authorization", () => {
  it("returns forbidden when edit capability is revoked before the attachment transaction", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "actor-a" } });
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getDatabase.mockReturnValue("database");
    mocks.requireOrganizationLedgerAccess.mockResolvedValue({ ledgerScopeId: "scope-a" });
    mocks.createExpenseReceipt.mockRejectedValue(new mocks.FakeOrganizationError("forbidden"));

    const response = await POST(uploadRequest(), { params: Promise.resolve({ organizationId: "org-a", expenseId: "expense-a" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You do not have permission to edit this Organization expense." });
    expect(mocks.createExpenseReceipt).toHaveBeenCalledWith(
      "database",
      { ledgerScopeId: "scope-a", organizationId: "org-a", userId: "actor-a", requiredCapability: "expenses.edit" },
      "expense-a",
      expect.objectContaining({ mediaType: "image/jpeg" }),
    );
  });
});
