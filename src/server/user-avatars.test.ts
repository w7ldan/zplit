import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateAvatarFile } from "../domain/avatar-file";
import { MAX_AVATAR_BYTES, normalizeUserAvatar } from "./user-avatars";

describe("user avatar storage", () => {
  it("accepts source images and normalizes them to a square WebP", async () => {
    const source = readFileSync("scripts/fixtures/showcase-dinner-receipt.png");
    const validated = validateAvatarFile({ bytes: new Uint8Array(source), filename: "photo.png", mediaType: "image/png" });
    const avatar = await normalizeUserAvatar(validated);
    const metadata = await sharp(avatar.content).metadata();
    expect(avatar.mediaType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(avatar.byteSize).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("rejects content and MIME mismatches before normalization", () => {
    for (const [bytes, mediaType] of [
      [Uint8Array.from([0xff, 0xd8, 0xff]), "image/jpeg"],
      [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
      [Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
    ] as const) {
      expect(validateAvatarFile({ bytes, filename: "photo", mediaType }).mediaType).toBe(mediaType);
    }
    expect(() => validateAvatarFile({ bytes: Uint8Array.from([1, 2, 3]), filename: "photo.jpg", mediaType: "image/jpeg" })).toThrow("JPEG, PNG, or WebP");
    expect(() => validateAvatarFile({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filename: "photo.jpg", mediaType: "image/jpeg" })).toThrow("does not match");
    expect(() => validateAvatarFile({ bytes: new Uint8Array(MAX_AVATAR_BYTES + 1), filename: "large", mediaType: "image/png" })).toThrow("5 MiB or smaller");
  });

  it("does not permit a viewer to read another user's avatar", async () => {
    const { getUserAvatarForViewer } = await import("./user-avatars");
    await expect(getUserAvatarForViewer({} as never, "user-a", "user-b")).resolves.toBeNull();
  });
});
