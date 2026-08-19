import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  getExpenseReceipt: vi.fn(),
  deleteExpenseReceipt: vi.fn(),
}));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/expense-receipts", () => ({
  getExpenseReceipt: mocks.getExpenseReceipt,
  deleteExpenseReceipt: mocks.deleteExpenseReceipt,
  RECEIPT_UNAVAILABLE_MESSAGE: "This expense or receipt is no longer available.",
  RECEIPT_READ_HEADERS: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  },
}));

import { DELETE, GET } from "./route";

const params = { params: Promise.resolve({ expenseId: "expense-a", receiptId: "33333333-3333-4333-8333-333333333333" }) };

describe("receipt read and delete route", () => {
  it("authenticates reads and returns exact bytes with private security headers and a fixed filename", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new Request("https://zplit.test/app"), params)).status).toBe(401);

    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.getExpenseReceipt.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", mediaType: "image/png", byteSize: bytes.length, content: bytes });
    const response = await GET(new Request("https://zplit.test/app/expenses/expense-a/receipts/receipt-a?filename=bad"), params);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("content-disposition")).toBe('inline; filename="receipt-33333333-3333-4333-8333-333333333333.png"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(mocks.getExpenseReceipt).toHaveBeenCalledWith("database", "owner-a", "expense-a", "33333333-3333-4333-8333-333333333333");

    const download = await GET(new Request("https://zplit.test/app/expenses/expense-a/receipts/receipt-a?download=1"), params);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="receipt-33333333-3333-4333-8333-333333333333.png"');
    expect(mocks.getExpenseReceipt).toHaveBeenLastCalledWith("database", "owner-a", "expense-a", "33333333-3333-4333-8333-333333333333");
  });

  it("returns a generic missing response for another owner and enforces same-origin delete", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-b" } });
    mocks.getExpenseReceipt.mockResolvedValue(null);
    expect((await GET(new Request("https://zplit.test/app"), params)).status).toBe(404);
    expect(mocks.getExpenseReceipt).toHaveBeenCalledWith("database", "owner-b", "expense-a", "33333333-3333-4333-8333-333333333333");

    const missingOrigin = await DELETE(new Request("https://zplit.test/app", { method: "DELETE" }), params);
    expect(missingOrigin.status).toBe(403);
    mocks.deleteExpenseReceipt.mockResolvedValue(true);
    const deleted = await DELETE(new Request("https://zplit.test/app", { method: "DELETE", headers: { Origin: "https://zplit.test" } }), params);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(mocks.deleteExpenseReceipt).toHaveBeenCalledWith("database", "owner-b", "expense-a", "33333333-3333-4333-8333-333333333333");
  });
});
