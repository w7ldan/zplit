import sharp from "sharp";
import {
  MAX_RECEIPT_BYTES,
  ReceiptFileValidationError,
  sha256Hex,
  type ReceiptFileLabel,
  type ValidatedReceiptFile,
} from "@/domain/receipt-file";

export const MAX_EVIDENCE_IMAGE_PIXELS = 40_000_000;
export const EVIDENCE_IMAGE_MEDIA_TYPE = "image/webp" as const;

function normalizedFilename(filename: string) {
  const stem = filename.replace(/\.[^.]*$/u, "");
  return `${Array.from(stem || "receipt").slice(0, 155).join("") || "receipt"}.webp`;
}

export async function normalizeEvidenceImage(
  file: ValidatedReceiptFile,
  label: ReceiptFileLabel = "Receipt",
): Promise<ValidatedReceiptFile> {
  try {
    if (file.content.byteLength === 0 || file.content.byteLength > MAX_RECEIPT_BYTES) {
      throw new ReceiptFileValidationError(`${label} files must be nonempty and 5 MiB or smaller.`);
    }
    const bytes = Buffer.from(file.content);
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_EVIDENCE_IMAGE_PIXELS,
      pages: 1,
    }).metadata();
    const expectedFormat = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    }[file.mediaType];
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_EVIDENCE_IMAGE_PIXELS ||
      (metadata.pages !== undefined && metadata.pages > 1)
    ) {
      throw new ReceiptFileValidationError(`${label} files must be a supported, single-frame image within the pixel limit.`);
    }

    const content = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_EVIDENCE_IMAGE_PIXELS,
      pages: 1,
    })
      .rotate()
      .webp({ quality: 96, smartSubsample: true, effort: 4 })
      .toBuffer();
    if (content.byteLength === 0 || content.byteLength > MAX_RECEIPT_BYTES) {
      throw new ReceiptFileValidationError(`${label} files must be 5 MiB or smaller after processing.`);
    }

    return {
      originalFilename: normalizedFilename(file.originalFilename),
      mediaType: EVIDENCE_IMAGE_MEDIA_TYPE,
      byteSize: content.byteLength,
      sha256: sha256Hex(content),
      content,
    };
  } catch (error) {
    if (error instanceof ReceiptFileValidationError) throw error;
    throw new ReceiptFileValidationError(`This ${label.toLowerCase()} image could not be processed.`);
  }
}
