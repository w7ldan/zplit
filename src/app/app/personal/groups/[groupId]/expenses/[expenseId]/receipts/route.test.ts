import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn(), getDatabase: vi.fn(), create: vi.fn() }));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-expense-receipts", () => ({ createGroupExpenseReceipt: mocks.create, GroupExpenseReceiptCountError: class extends Error { constructor() { super("An expense can have up to 5 receipts."); } }, GroupExpenseReceiptDuplicateError: class extends Error {}, GroupExpenseReceiptPermissionError: class extends Error {}, GroupExpenseReceiptTotalSizeError: class extends Error {}, GroupExpenseReceiptUnavailableError: class extends Error {} }));

import { POST } from "./route";

const params = { params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a" }) };

function request(file = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])], "dinner.jpg", { type: "image/jpeg" }), headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("receipt", file);
  const request = new Request("https://zplit.test/app/personal/groups/group-a/expenses/expense-a/receipts", { method: "POST", headers: { Origin: "https://zplit.test", "Content-Length": "100", ...headers } });
  Object.defineProperty(request, "formData", { value: async () => form });
  return request;
}

describe("Group receipt upload route", () => {
  it("requires authentication and same-origin bounded uploads", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(401);
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    expect((await POST(request(undefined, { Origin: "" }), params)).status).toBe(403);
    expect((await POST(request(undefined, { "Content-Length": String(6 * 1024 * 1024 + 1) }), params)).status).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("validates the signed image and binds storage to Group and expense IDs", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const receipt = { id: "receipt-a", originalFilename: "dinner.jpg", mediaType: "image/jpeg", byteSize: 5, createdAt: new Date("2026-08-27T12:00:00Z") };
    mocks.create.mockResolvedValue(receipt);
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ receipt: { id: "receipt-a", originalFilename: "dinner.jpg" } });
    expect(mocks.create).toHaveBeenCalledWith("database", "group-a", "expense-a", "user-a", expect.objectContaining({ mediaType: "image/jpeg", byteSize: 5 }));
    expect(JSON.stringify(body)).not.toContain("sha256");
  });
});
