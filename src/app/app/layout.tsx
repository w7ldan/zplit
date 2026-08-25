import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { resolveInstallationOwner } from "@/auth/invitations";
import { getUnreadNotificationCountForUser } from "@/server/notifications";
import { getUserAvatarMetadata } from "@/server/user-avatars";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();
  const [owner, unreadCount, avatar] = await Promise.all([
    resolveInstallationOwner(getDatabase()),
    getUnreadNotificationCountForUser(session.user.id),
    getUserAvatarMetadata(getDatabase(), session.user.id),
  ]);
  return <AppShell user={{ ...session.user, avatar }} canManageInvites={owner?.id === session.user.id} initialUnreadCount={unreadCount}>{children}</AppShell>;
}
