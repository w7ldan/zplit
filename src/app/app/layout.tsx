import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { resolveInstallationOwner } from "@/auth/invitations";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();
  const owner = await resolveInstallationOwner(getDatabase());
  return <AppShell user={session.user} canManageInvites={owner?.id === session.user.id}>{children}</AppShell>;
}
