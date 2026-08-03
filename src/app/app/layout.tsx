import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { requireSession } from "@/auth/require-session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();
  return <AppShell user={session.user}>{children}</AppShell>;
}
