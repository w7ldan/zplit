"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { HeaderShell } from "@/components/navigation/header-shell";
import { ToastProvider } from "@/components/feedback/toast";
import { DeleteConfirmation } from "./delete-record-form";
import { UnsavedChangesProvider } from "@/components/navigation/unsaved-changes";
import { ThemeControl } from "@/components/theme/theme-provider";
import { GlobalSearch } from "./global-search";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";

const destinations = [
  ["Overview", "/app"],
  ["Friends", "/app/friends"],
  ["Outings", "/app/outings"],
  ["Expenses", "/app/expenses"],
  ["Repayments", "/app/repayments"],
] as const;

type AppShellProps = {
  user: {
    name: string;
    email: string;
  };
  canManageInvites?: boolean;
  children: ReactNode;
};

function isCurrent(pathname: string, href: string) {
  if (href === "/app/outings" && (pathname === "/app/trips" || pathname.startsWith("/app/trips/"))) return true;
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, canManageInvites, children }: AppShellProps) {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    document.documentElement.classList.add("zplit-product-mode");
    return () => document.documentElement.classList.remove("zplit-product-mode");
  }, []);

  return (
    <RealtimeProvider>
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
            <span className="technical-label">PRIVATE LEDGER</span>
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
            <GlobalSearch />
            <Link className="action-link action-link--primary app-shell__add-expense" href="/app/expenses?create=1" data-task-trigger="expense-create">Add expense</Link>
            <details className="account-menu">
              <summary aria-label={`Open account menu for ${user.name}`}><span className="account-menu__name">{user.name}</span></summary>
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
