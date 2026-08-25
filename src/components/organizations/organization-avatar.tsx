import { UserAvatar, type AvatarReference, type AvatarSize } from "@/components/identity/user-avatar";

export function OrganizationAvatar({ organizationId, customAvatar, size = "md", decorative = false }: { organizationId: string; customAvatar?: AvatarReference | null; size?: AvatarSize; decorative?: boolean }) {
  const avatarUrl = customAvatar ? `/app/organizations/${encodeURIComponent(organizationId)}/avatar?v=${encodeURIComponent(customAvatar.sha256)}` : undefined;
  return <UserAvatar userId={`organization:${organizationId}`} customAvatar={customAvatar} customAvatarUrl={avatarUrl} size={size} alt="Organization avatar" decorative={decorative} />;
}
