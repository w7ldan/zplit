import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ReceiptFileValidationError, validateReceiptFile } from "@/domain/receipt-file";
import { createValidatedReceiptImage } from "@/test/receipt-image";
import { EVIDENCE_IMAGE_MEDIA_TYPE, MAX_EVIDENCE_IMAGE_PIXELS, normalizeEvidenceImage } from "./evidence-images";

describe("evidence image normalization", () => {
  it("re-encodes every currently supported image type as WebP", async () => {
    const png = await createValidatedReceiptImage();
    const jpegBytes = await sharp(Buffer.from(png.content)).jpeg().toBuffer();
    const webpBytes = await sharp(Buffer.from(png.content)).webp().toBuffer();
    const inputs = [
      png,
      validateReceiptFile({ bytes: new Uint8Array(jpegBytes), filename: "receipt.jpg", mediaType: "image/jpeg" }),
      validateReceiptFile({ bytes: new Uint8Array(webpBytes), filename: "receipt.webp", mediaType: "image/webp" }),
    ];

    for (const input of inputs) {
      const normalized = await normalizeEvidenceImage(input);
      const metadata = await sharp(normalized.content).metadata();
      expect(metadata.format).toBe("webp");
      expect(normalized).toMatchObject({ mediaType: EVIDENCE_IMAGE_MEDIA_TYPE, originalFilename: "receipt.webp" });
      expect(normalized.byteSize).toBe(normalized.content.byteLength);
    }
  });

  it("removes EXIF GPS/device data and the marker while applying orientation to pixels", async () => {
    const marker = "DEVFLOW_EXIF_SECRET_92817";
    const source = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "red" },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: "Fixture camera", Model: "Fixture device", ImageDescription: marker },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 34/1 56/1" },
      })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.exif?.includes(Buffer.from("Fixture camera"))).toBe(true);

    const normalized = await normalizeEvidenceImage(validateReceiptFile({
      bytes: new Uint8Array(source),
      filename: "proof.jpeg",
      mediaType: "image/jpeg",
    }), "Payment proof");
    const outputMetadata = await sharp(normalized.content).metadata();

    expect(outputMetadata).toMatchObject({ format: "webp", width: 2, height: 3 });
    expect(outputMetadata.orientation).toBeUndefined();
    expect(outputMetadata.exif).toBeUndefined();
    expect(outputMetadata.icc).toBeUndefined();
    expect(outputMetadata.xmp).toBeUndefined();
    expect(outputMetadata.iptc).toBeUndefined();
    expect(Buffer.from(normalized.content).toString("latin1").includes(marker)).toBe(false);
    expect(normalized.originalFilename).toBe("proof.webp");
  });

  it("rejects malformed payloads, unsupported formats, and dimensions above the pixel limit", async () => {
    const malformed = validateReceiptFile({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      filename: "spoof.jpg",
      mediaType: "image/jpeg",
    });
    await expect(normalizeEvidenceImage(malformed)).rejects.toBeInstanceOf(ReceiptFileValidationError);

    const gif = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).gif().toBuffer();
    expect(() => validateReceiptFile({ bytes: gif, filename: "receipt.gif", mediaType: "image/gif" })).toThrow(ReceiptFileValidationError);

    const animation = await Promise.all(["red", "blue"].map((background) => sharp({
      create: { width: 32, height: 32, channels: 4, background },
    }).png().toBuffer()));
    const animatedGif = await sharp(animation, { join: { animated: true } }).gif().toBuffer();
    const animatedWebp = await sharp(animatedGif, { animated: true }).webp().toBuffer();
    await expect(normalizeEvidenceImage(validateReceiptFile({
      bytes: new Uint8Array(animatedWebp),
      filename: "animated.webp",
      mediaType: "image/webp",
    }))).rejects.toBeInstanceOf(ReceiptFileValidationError);

    const oversizedDimensions = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x13, 0x88, 0x23, 0x28,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11,
      0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
    ]);
    expect(9000 * 5000).toBeGreaterThan(MAX_EVIDENCE_IMAGE_PIXELS);
    await expect(normalizeEvidenceImage(validateReceiptFile({
      bytes: oversizedDimensions,
      filename: "large.jpg",
      mediaType: "image/jpeg",
    }))).rejects.toBeInstanceOf(ReceiptFileValidationError);
  });
});
