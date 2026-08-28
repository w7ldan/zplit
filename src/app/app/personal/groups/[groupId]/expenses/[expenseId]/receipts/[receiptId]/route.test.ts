import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn(), getDatabase: vi.fn(), get: vi.fn(), remove: vi.fn() }));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-expense-receipts", () => ({ getGroupExpenseReceipt: mocks.get, deleteGroupExpenseReceipt: mocks.remove, GroupExpenseReceiptPermissionError: class extends Error {}, GROUP_RECEIPT_UNAVAILABLE_MESSAGE: "This expense or receipt is no longer available." }));
vi.mock("@/server/expense-receipts", () => ({ RECEIPT_READ_HEADERS: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" } }));

import { DELETE, GET } from "./route";

const params = { params: Promise.resolve({ groupId: "group-a", expenseId: "expense-a", receiptId: "receipt-a" }) };

describe("Group receipt read route", () => {
  it("returns private bytes only through the Group-scoped service", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.get.mockResolvedValue({ id: "receipt-a", mediaType: "image/png", byteSize: content.length, content });
    const response = await GET(new Request("https://zplit.test/app"), params);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(content));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith("database", "group-a", "expense-a", "receipt-a", "user-a");
  });

  it("protects delete with same-origin and the Group-scoped creator policy", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.remove.mockResolvedValue(true);
    expect((await DELETE(new Request("https://zplit.test/app", { method: "DELETE" }), params)).status).toBe(403);
    expect((await DELETE(new Request("https://zplit.test/app", { method: "DELETE", headers: { Origin: "https://zplit.test" } }), params)).status).toBe(204);
    expect(mocks.remove).toHaveBeenCalledWith("database", "group-a", "expense-a", "receipt-a", "user-a");
  });
});
