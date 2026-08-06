"use client";

import type { ReactNode } from "react";
import { useDetachedHeader } from "./use-detached-header";

type HeaderShellProps = {
  ariaLabel: string;
  navigationLabel: string;
  brand: ReactNode;
  navigation: ReactNode;
  actions: ReactNode;
  className?: string;
  panelClassName?: string;
  brandClassName?: string;
  navigationClassName?: string;
  actionsClassName?: string;
};

function classes(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(" ");
}

export function HeaderShell({
  ariaLabel,
  navigationLabel,
  brand,
  navigation,
  actions,
  className,
  panelClassName,
  brandClassName,
  navigationClassName,
  actionsClassName,
}: HeaderShellProps) {
  const detached = useDetachedHeader();

  return (
    <header
      className={classes("header-shell", className, detached && "header-shell--detached")}
      data-detached={detached}
      role="banner"
      aria-label={ariaLabel}
    >
      <div
        className={classes("header-shell__panel", "editorial-shell", "editorial-grid", panelClassName, detached && "header-shell__panel--detached")}
        data-detached={detached}
      >
        <div className={classes("header-shell__brand", brandClassName)}>{brand}</div>
        <nav className={classes("header-shell__nav", navigationClassName)} aria-label={navigationLabel}>
          {navigation}
        </nav>
        <div className={classes("header-shell__actions", actionsClassName)}>{actions}</div>
      </div>
    </header>
  );
}
