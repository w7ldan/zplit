"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { HeaderShell } from "@/components/navigation/header-shell";
import { ToastProvider } from "@/components/feedback/toast";
import { DeleteConfirmation } from "./delete-record-form";
import { UnsavedChangesProvider } from "@/components/navigation/unsaved-changes";
import { ThemeControl } from "@/components/theme/theme-provider";
import { GlobalSearch } from "./global-search";
import { RealtimeProvider, useRealtime } from "@/components/realtime/realtime-provider";
import { InboxControl } from "@/components/notifications/inbox-control";
import { UserAvatar, type AvatarReference } from "@/components/identity/user-avatar";
import { CHAT_STATE_CHANGED_EVENT } from "@/domain/chat";

const destinations = [
  ["Overview", "/app"],
  ["Personal", "/app/personal"],
  ["Organizations", "/app/organizations"],
] as const;

const personalPaths = ["/app/personal", "/app/friends", "/app/outings", "/app/trips", "/app/expenses", "/app/repayments", "/app/history", "/app/exports"];

type AppShellProps = {
  user: {
    id: string;
    name: string;
    email: string;
    avatar?: AvatarReference | null;
  };
  canManageInvites?: boolean;
  initialUnreadCount?: number;
  children: ReactNode;
};

function isCurrent(pathname: string, href: string) {
  if (href === "/app/personal") return personalPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function ChatLiveRefresh({ pathname }: { pathname: string }) {
  const router = useRouter();
  const { openCount, subscribe } = useRealtime();

  useEffect(() => subscribe(CHAT_STATE_CHANGED_EVENT, (event) => {
    const entityId = event.data.scope === "organization"
      ? event.data.organizationId
      : event.data.scope === "group"
        ? event.data.groupId
        : undefined;
    if (typeof entityId !== "string") return;
    const prefix = event.data.scope === "organization"
      ? `/app/organizations/${entityId}`
      : `/app/personal/groups/${entityId}`;
    if (pathname.startsWith(prefix)) router.refresh();
  }), [pathname, router, subscribe]);

  useEffect(() => {
    if (openCount > 0 && (pathname.startsWith("/app/organizations/") || pathname.startsWith("/app/personal/groups/"))) router.refresh();
  }, [openCount, pathname, router]);

  return null;
}

export function AppShell({ user, canManageInvites, initialUnreadCount = 0, children }: AppShellProps) {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    document.documentElement.classList.add("zplit-product-mode");
    return () => document.documentElement.classList.remove("zplit-product-mode");
  }, []);

  return (
    <RealtimeProvider>
      <ChatLiveRefresh pathname={pathname} />
      <UnsavedChangesProvider>
        <ToastProvider>
        <div className="app-shell">
      <HeaderShell
        ariaLabel="Ledger header"
        navigationLabel="Ledger navigation"
        className="app-shell__header"
        panelClassName="app-shell__header-layout"
        brandClassName="app-shell__brand"
        navigationClassName="app-shell__nav"
        actionsClassName="app-shell__actions"
        brand={(
          <Link href="/app" aria-label="Zplit overview">
            <span className="app-shell__wordmark">Zplit</span>
          </Link>
        )}
        navigation={(
          <>
            {destinations.map(([label, href]) => (
              <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined} className={isCurrent(pathname, href) ? "app-shell__nav-link app-shell__nav-link--active" : "app-shell__nav-link"}>
                {label}
              </Link>
            ))}
          </>
        )}
        actions={(
          <>
            <InboxControl initialUnreadCount={initialUnreadCount} active={isCurrent(pathname, "/app/inbox")} />
            <GlobalSearch />
            <details className="account-menu">
              <summary aria-label={`Open account menu for ${user.name}`}><UserAvatar userId={user.id} customAvatar={user.avatar} size="sm" decorative /><span className="account-menu__name">{user.name}</span></summary>
              <div className="account-menu__panel">
                <span className="technical-label">Signed in as</span>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <Link href="/app/history">History</Link>
                <Link href="/app/exports">Exports</Link>
                <Link href="/app/settings">Settings</Link>
                {canManageInvites ? <Link href="/app/invites">Invitations</Link> : null}
                <ThemeControl />
                <SignOutButton />
              </div>
            </details>
          </>
        )}
      />
      <nav className="app-shell__mobile-nav" aria-label="Mobile ledger navigation">
        {destinations.map(([label, href]) => (
          <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined} className={isCurrent(pathname, href) ? "app-shell__mobile-link app-shell__mobile-link--active" : "app-shell__mobile-link"}>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
        <main className="app-shell__main"><DeleteConfirmation />{children}</main>
        </div>
        </ToastProvider>
      </UnsavedChangesProvider>
    </RealtimeProvider>
  );
}
