import type { ReactNode } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";

type AppShellProps = {
  user: {
    name: string;
    email: string;
  };
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="editorial-grid editorial-shell app-shell__header-layout">
          <Link className="app-shell__brand" href="/app" aria-label="Zplit index">
            <span className="app-shell__wordmark">Zplit</span>
            <span className="technical-label">PRIVATE LEDGER</span>
          </Link>
          <div className="app-shell__owner" aria-label="Signed-in owner">
            <span className="technical-label">Owner</span>
            <strong>{user.name}</strong>
          </div>
          <nav className="app-shell__nav" aria-label="Ledger navigation">
            <Link href="/app">Overview</Link>
            <Link href="/app/friends">Friends</Link>
            <Link href="/app/outings">Outings</Link>
            <Link href="/app/expenses">Expenses</Link>
          </nav>
          <div className="app-shell__account">
            <span className="technical-label">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
