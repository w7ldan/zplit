"use client";

import Link, { type LinkProps } from "next/link";
import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";

type OverviewLinkProps = LinkProps & {
  className?: string;
  children: ReactNode;
  magnetic?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  "data-task-trigger"?: string;
};

export function OverviewLink({ children, className, magnetic = true, onClick, ...props }: OverviewLinkProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const boundsRef = useRef<DOMRect | null>(null);

  function resetPointer() {
    boundsRef.current = null;
    linkRef.current?.style.removeProperty("--overview-pointer-x");
    linkRef.current?.style.removeProperty("--overview-pointer-y");
  }

  function handlePointerMove(event: PointerEvent<HTMLAnchorElement>) {
    if (!magnetic || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    const element = linkRef.current;
    const bounds = boundsRef.current;
    if (!element || !bounds) return;
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    element.style.setProperty("--overview-pointer-x", `${Math.max(-1, Math.min(1, x))}`);
    element.style.setProperty("--overview-pointer-y", `${Math.max(-1, Math.min(1, y))}`);
  }

  return (
    <Link
      {...props}
      ref={linkRef}
      className={className}
      onClick={onClick}
      onPointerEnter={() => { boundsRef.current = linkRef.current?.getBoundingClientRect() ?? null; }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
    >
      {children}
    </Link>
  );
}
