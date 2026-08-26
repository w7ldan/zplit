import { UserAvatar, type AvatarReference, type AvatarSize } from "@/components/identity/user-avatar";

export function groupAvatarSeed(groupId: string) {
  return `group:${groupId}`;
}

export function GroupAvatar({ groupId, customAvatar, size = "md", decorative = false }: { groupId: string; customAvatar?: AvatarReference | null; size?: AvatarSize; decorative?: boolean }) {
  const avatarUrl = customAvatar ? `/app/personal/groups/${encodeURIComponent(groupId)}/avatar?v=${encodeURIComponent(customAvatar.sha256)}` : undefined;
  return <UserAvatar userId={groupAvatarSeed(groupId)} customAvatar={customAvatar} customAvatarUrl={avatarUrl} size={size} alt="Group avatar" decorative={decorative} />;
}
