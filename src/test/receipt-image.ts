import sharp from "sharp";
import { validateReceiptFile } from "@/domain/receipt-file";

export async function createValidatedReceiptImage(filename = "receipt.png") {
  const content = await sharp({
    create: { width: 4, height: 3, channels: 3, background: "white" },
  }).png().toBuffer();
  return validateReceiptFile({ bytes: new Uint8Array(content), filename, mediaType: "image/png" });
}
