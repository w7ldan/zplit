"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { useDetachedHeader } from "@/components/navigation/use-detached-header";
import { DeleteConfirmation } from "./delete-record-form";

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
  return href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, canManageInvites, children }: AppShellProps) {
  const pathname = usePathname() ?? "";
  const detached = useDetachedHeader();

  useEffect(() => {
    document.documentElement.classList.add("zplit-product-mode");
    return () => document.documentElement.classList.remove("zplit-product-mode");
  }, []);

  return (
    <div className="app-shell">
      <header className={`app-shell__header${detached ? " app-shell__header--detached" : ""}`}>
        <div className={`editorial-shell app-shell__header-layout${detached ? " app-shell__header-layout--detached" : ""}`} data-detached={detached}>
          <Link className="app-shell__brand" href="/app" aria-label="Zplit overview">
            <span className="app-shell__wordmark">Zplit</span>
            <span className="technical-label">PRIVATE LEDGER</span>
          </Link>
          <nav className="app-shell__nav" aria-label="Ledger navigation">
            {destinations.map(([label, href]) => (
              <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined} className={isCurrent(pathname, href) ? "app-shell__nav-link app-shell__nav-link--active" : "app-shell__nav-link"}>
                {label}
              </Link>
            ))}
          </nav>
          <Link className="action-link action-link--primary app-shell__add-expense" href="/app/expenses?create=1" data-task-trigger="expense-create">
            Add expense
          </Link>
          <details className="account-menu">
            <summary aria-label={`Open account menu for ${user.name}`}><span className="account-menu__name">{user.name}</span></summary>
            <div className="account-menu__panel">
              <span className="technical-label">Signed in as</span>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
              <Link href="/app/history">History</Link>
              <Link href="/app/exports">Exports</Link>
              {canManageInvites ? <Link href="/app/invites">Invitations</Link> : null}
              <SignOutButton />
            </div>
          </details>
        </div>
      </header>
      <nav className="app-shell__mobile-nav" aria-label="Mobile ledger navigation">
        {destinations.map(([label, href]) => (
          <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? "page" : undefined} className={isCurrent(pathname, href) ? "app-shell__mobile-link app-shell__mobile-link--active" : "app-shell__mobile-link"}>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <main className="app-shell__main"><DeleteConfirmation />{children}</main>
    </div>
  );
}
