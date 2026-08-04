import { createHash } from "node:crypto";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPTS_PER_EXPENSE = 5;
export const MAX_RECEIPT_BYTES_PER_EXPENSE = 15 * 1024 * 1024;

export type ReceiptMediaType = "image/jpeg" | "image/png" | "image/webp";

export type ValidatedReceiptFile = {
  originalFilename: string;
  mediaType: ReceiptMediaType;
  byteSize: number;
  sha256: string;
  content: Uint8Array;
};

export class ReceiptFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptFileValidationError";
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

export function detectReceiptMediaType(bytes: Uint8Array): ReceiptMediaType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

export function sanitizeReceiptFilename(filename: string) {
  const basename = filename.replace(/^.*[\\/]/, "");
  const safe = Array.from(
    basename.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").replace(/\s+/gu, " ").trim(),
  )
    .slice(0, 160)
    .join("");
  return safe === "." || safe === ".." ? "receipt" : safe || "receipt";
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateReceiptFile(input: {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
}): ValidatedReceiptFile {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new ReceiptFileValidationError("Receipt files cannot be empty.");
  }
  if (input.bytes.byteLength > MAX_RECEIPT_BYTES) {
    throw new ReceiptFileValidationError("Receipt files must be 5 MiB or smaller.");
  }

  const mediaType = detectReceiptMediaType(input.bytes);
  if (!mediaType) throw new ReceiptFileValidationError("Receipt files must be JPEG, PNG, or WebP images.");
  const reportedMediaType = input.mediaType.trim().toLowerCase();
  if (reportedMediaType && reportedMediaType !== mediaType) {
    throw new ReceiptFileValidationError("The receipt MIME type does not match its contents.");
  }

  return {
    originalFilename: sanitizeReceiptFilename(input.filename),
    mediaType,
    byteSize: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
    content: new Uint8Array(input.bytes),
  };
}
