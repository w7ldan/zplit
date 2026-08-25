import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { Database } from "../db/client";
import { userAvatars } from "../db/schema";
import { AvatarFileValidationError } from "../domain/avatar-file";
import { sha256Hex, type ValidatedReceiptFile } from "../domain/receipt-file";

export const AVATAR_MEDIA_TYPE = "image/webp" as const;
export const AVATAR_SIZE = 512;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_READ_HEADERS = {
  "Cache-Control": "private, max-age=0, must-revalidate",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

export type UserAvatarMetadata = {
  mediaType: typeof AVATAR_MEDIA_TYPE;
  byteSize: number;
  sha256: string;
};

export type UserAvatarContent = UserAvatarMetadata & { content: Buffer };

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new Error("A user avatar owner is required");
}

function metadataSelection() {
  return {
    mediaType: userAvatars.mediaType,
    byteSize: userAvatars.byteSize,
    sha256: userAvatars.sha256,
  };
}

export async function normalizeUserAvatar(input: ValidatedReceiptFile): Promise<{
  mediaType: typeof AVATAR_MEDIA_TYPE;
  byteSize: number;
  sha256: string;
  content: Buffer;
}> {
  let content: Buffer;
  try {
    // ponytail: center crop keeps upload UX dependency-free; add manual crop if subject positioning becomes necessary.
    content = await sharp(Buffer.from(input.content), { failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AvatarFileValidationError("This avatar image could not be processed.");
  }
  if (content.byteLength === 0 || content.byteLength > MAX_AVATAR_BYTES) {
    throw new AvatarFileValidationError("The normalized avatar is too large.");
  }
  return { mediaType: AVATAR_MEDIA_TYPE, byteSize: content.byteLength, sha256: sha256Hex(content), content };
}

export async function getUserAvatarMetadata(database: Database, userId: string): Promise<UserAvatarMetadata | null> {
  assertUserId(userId);
  const [avatar] = await database
    .select(metadataSelection())
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  return avatar ? { ...avatar, mediaType: AVATAR_MEDIA_TYPE } : null;
}

export async function getUserAvatar(database: Database, userId: string): Promise<UserAvatarContent | null> {
  assertUserId(userId);
  const [avatar] = await database
    .select({ ...metadataSelection(), content: userAvatars.content })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  return avatar ? { ...avatar, mediaType: AVATAR_MEDIA_TYPE } : null;
}

export async function saveUserAvatar(
  database: Database,
  userId: string,
  avatar: { mediaType: typeof AVATAR_MEDIA_TYPE; byteSize: number; sha256: string; content: Uint8Array },
): Promise<UserAvatarMetadata> {
  assertUserId(userId);
  const [saved] = await database
    .insert(userAvatars)
    .values({ ...avatar, userId, content: Buffer.from(avatar.content) })
    .onConflictDoUpdate({
      target: userAvatars.userId,
      set: { mediaType: avatar.mediaType, byteSize: avatar.byteSize, sha256: avatar.sha256, content: Buffer.from(avatar.content), updatedAt: new Date() },
    })
    .returning(metadataSelection());
  if (!saved) throw new Error("Unable to save the user avatar");
  return { ...saved, mediaType: AVATAR_MEDIA_TYPE };
}

export async function deleteUserAvatar(database: Database, userId: string) {
  assertUserId(userId);
  const deleted = await database.delete(userAvatars).where(eq(userAvatars.userId, userId)).returning({ userId: userAvatars.userId });
  return deleted.length > 0;
}
