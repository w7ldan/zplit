import type { Database } from "../db/client";
import { getUserAvatar, type UserAvatarContent } from "./user-avatars";

export function canReadUserAvatar(viewerUserId: string, subjectUserId: string) {
  return Boolean(viewerUserId.trim()) && Boolean(subjectUserId.trim()) && viewerUserId === subjectUserId;
}

export async function getUserAvatarForViewer(database: Database, viewerUserId: string, subjectUserId: string): Promise<UserAvatarContent | null> {
  if (!canReadUserAvatar(viewerUserId, subjectUserId)) return null;
  return getUserAvatar(database, subjectUserId);
}
