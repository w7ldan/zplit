import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn(), getReceipt: vi.fn() }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/debtor-share-links", () => ({ getSharedDebtorReceipt: mocks.getReceipt, PUBLIC_RECEIPT_UNAVAILABLE: "This receipt is unavailable." }));

import { GET } from "./route";

describe("public shared receipt route", () => {
  it("returns exact bytes with private, non-sniffing headers and a public-id filename", async () => {
    const bytes = Buffer.from([1, 2, 3]);
    mocks.getReceipt.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", mediaType: "image/png", byteSize: bytes.length, content: bytes });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ token: "11111111-1111-4111-8111-111111111111", publicReceiptId: "22222222-2222-4222-8222-222222222222" }) });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="receipt-22222222-2222-4222-8222-222222222222.png"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("changes only the disposition for download requests", async () => {
    const bytes = Buffer.from([4, 5, 6]);
    const receipt = { id: "22222222-2222-4222-8222-222222222222", mediaType: "image/png", byteSize: bytes.length, content: bytes };
    mocks.getReceipt.mockResolvedValue(receipt);
    const params = { params: Promise.resolve({ token: "11111111-1111-4111-8111-111111111111", publicReceiptId: receipt.id }) };
    const inline = await GET(new Request("http://localhost/share/token/receipts/receipt"), params);
    const download = await GET(new Request("http://localhost/share/token/receipts/receipt?download=1"), params);

    expect(Buffer.from(await inline.arrayBuffer())).toEqual(bytes);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    for (const header of ["Content-Type", "Content-Length", "Cache-Control", "X-Content-Type-Options", "Content-Security-Policy", "Referrer-Policy", "Cross-Origin-Resource-Policy"]) {
      expect(download.headers.get(header)).toBe(inline.headers.get(header));
    }
    expect(inline.headers.get("Content-Disposition")).toBe('inline; filename="receipt-22222222-2222-4222-8222-222222222222.png"');
    expect(download.headers.get("Content-Disposition")).toBe('attachment; filename="receipt-22222222-2222-4222-8222-222222222222.png"');
  });

  it("uses one generic 404 response for unavailable combinations", async () => {
    mocks.getReceipt.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ token: "malformed", publicReceiptId: "bad" }) });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("This receipt is unavailable.");
  });
});
