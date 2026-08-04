import { describe, expect, it } from "vitest";
import {
  detectReceiptMediaType,
  MAX_RECEIPT_BYTES,
  sanitizeReceiptFilename,
  sha256Hex,
  validateReceiptFile,
  ReceiptFileValidationError,
} from "./receipt-file";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe("receipt file validation", () => {
  it("detects the three supported signatures and rejects malformed ones", () => {
    expect(detectReceiptMediaType(jpeg)).toBe("image/jpeg");
    expect(detectReceiptMediaType(png)).toBe("image/png");
    expect(detectReceiptMediaType(webp)).toBe("image/webp");
    expect(detectReceiptMediaType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(detectReceiptMediaType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull();
    expect(detectReceiptMediaType(Uint8Array.from([0, 1, 2]))).toBeNull();
  });

  it("sanitizes paths, controls, whitespace, and unsafe dot names", () => {
    expect(sanitizeReceiptFilename("C:\\temp\\  dinner\nreceipt.png\u0000")).toBe("dinnerreceipt.png");
    expect(sanitizeReceiptFilename("../../")).toBe("receipt");
    expect(sanitizeReceiptFilename("x".repeat(200))).toHaveLength(160);
  });

  it("accepts signature bytes, ignores an empty browser MIME, and hashes bytes", () => {
    const file = validateReceiptFile({ bytes: jpeg, filename: "../dinner.jpg", mediaType: "IMAGE/JPEG" });
    expect(file).toMatchObject({ originalFilename: "dinner.jpg", mediaType: "image/jpeg", byteSize: jpeg.length, sha256: sha256Hex(jpeg) });
    expect(file.content).not.toBe(jpeg);
  });

  it("rejects empty, oversized, unsupported, and MIME-spoofed files", () => {
    for (const input of [
      { bytes: new Uint8Array(), filename: "empty", mediaType: "" },
      { bytes: new Uint8Array(MAX_RECEIPT_BYTES + 1), filename: "large", mediaType: "image/png" },
      { bytes: Uint8Array.from([1, 2, 3]), filename: "bad", mediaType: "image/png" },
      { bytes: png, filename: "spoof", mediaType: "image/jpeg" },
    ]) {
      expect(() => validateReceiptFile(input)).toThrow(ReceiptFileValidationError);
    }
  });
});
