import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  getDatabase: vi.fn(),
  createExpenseReceipt: vi.fn(),
}));

vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/auth/runtime", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/expense-receipts", () => ({
  createExpenseReceipt: mocks.createExpenseReceipt,
  ExpenseReceiptCountError: class ExpenseReceiptCountError extends Error { constructor() { super("An expense can have up to 5 receipts."); } },
  ExpenseReceiptDuplicateError: class ExpenseReceiptDuplicateError extends Error {},
  ExpenseReceiptTotalSizeError: class ExpenseReceiptTotalSizeError extends Error {},
  ExpenseReceiptUnavailableError: class ExpenseReceiptUnavailableError extends Error {},
}));

import { POST } from "./route";

const metadata = {
  id: "33333333-3333-4333-8333-333333333333",
  originalFilename: "dinner.jpg",
  mediaType: "image/jpeg",
  byteSize: 5,
  createdAt: new Date("2026-08-05T00:00:00.000Z"),
};

function request(file = new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0])], "dinner.jpg", { type: "image/jpeg" }), fields: Record<string, string | File> = { receipt: file }, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const request = new Request("https://zplit.test/app/expenses/22222222-2222-4222-8222-222222222222/receipts", {
    method: "POST",
    headers: { Origin: "https://zplit.test", "Content-Length": "100000", ...headers },
  });
  Object.defineProperty(request, "formData", { value: async () => form });
  return request;
}

describe("receipt upload route", () => {
  it("authenticates independently and refuses missing origin or bounded length before parsing", async () => {
    mocks.getSession.mockResolvedValue(null);
    const unauthorized = await POST(request(), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(unauthorized.status).toBe(401);

    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    const noOrigin = await POST(request(undefined, undefined, { Origin: "" }), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(noOrigin.status).toBe(403);
    const tooLarge = await POST(request(undefined, undefined, { "Content-Length": String(6 * 1024 * 1024 + 1) }), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(tooLarge.status).toBe(413);
    expect(mocks.createExpenseReceipt).not.toHaveBeenCalled();
  });

  it("accepts exactly one signed file, binds it to the session owner, and returns safe metadata", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://zplit.test");
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createExpenseReceipt.mockResolvedValue(metadata);

    const response = await POST(request(), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.receipt).toMatchObject({ ...metadata, createdAt: metadata.createdAt.toISOString() });
    expect(JSON.stringify(body)).not.toContain("sha256");
    expect(JSON.stringify(body)).not.toContain("content");
    expect(mocks.createExpenseReceipt).toHaveBeenCalledWith("database", "owner-a", "expense-a", expect.objectContaining({ mediaType: "image/jpeg", byteSize: 5 }));
  });

  it("rejects extra fields and MIME/signature spoofing without exposing internals", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    const extra = await POST(request(undefined, { receipt: new File([new Uint8Array([1])], "bad", { type: "image/png" }), extra: "no" }), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(extra.status).toBe(400);
    expect(await extra.json()).toEqual({ field: "receipt", error: "Choose one receipt image." });

    const spoofed = await POST(request(new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "bad.jpg", { type: "image/jpeg" })), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(spoofed.status).toBe(400);
    expect((await spoofed.json()).error).toBe("The receipt MIME type does not match its contents.");
  });

  it("maps owner-unavailable and invariant errors to generic safe responses", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.createExpenseReceipt.mockRejectedValue(new (await import("@/server/expense-receipts")).ExpenseReceiptUnavailableError());
    expect((await POST(request(), { params: Promise.resolve({ expenseId: "foreign" }) })).status).toBe(404);
    mocks.createExpenseReceipt.mockRejectedValue(new (await import("@/server/expense-receipts")).ExpenseReceiptCountError());
    const response = await POST(request(), { params: Promise.resolve({ expenseId: "expense-a" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "An expense can have up to 5 receipts." });
  });
});
