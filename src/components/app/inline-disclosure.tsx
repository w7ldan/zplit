"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

type InlineDisclosureProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  children: ReactNode;
};

const disclosureExitMs = 240;

export function InlineDisclosure({ open, children, className, onTransitionEnd, ...props }: InlineDisclosureProps) {
  const [, forceRender] = useState(0);
  const hasBeenOpen = useRef(open);
  const exitTimer = useRef<number | null>(null);
  if (open) hasBeenOpen.current = true;
  const visible = open || hasBeenOpen.current;
  const closing = !open && visible;

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    if (open || !visible) {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      hasBeenOpen.current = false;
      forceRender((version) => version + 1);
    }, reduced ? 0 : disclosureExitMs);
    return () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    };
  }, [open, visible]);

  if (!visible) return null;

  return (
    <div
      {...props}
      className={["inline-disclosure", className, closing ? "inline-disclosure--closing" : ""].filter(Boolean).join(" ")}
      data-inline-disclosure="true"
      data-inline-disclosure-state={closing ? "closing" : "open"}
      inert={closing || undefined}
      aria-hidden={closing ? "true" : undefined}
      onTransitionEnd={(event) => {
        onTransitionEnd?.(event);
        if (closing && event.target === event.currentTarget && event.propertyName === "opacity") {
          if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
          exitTimer.current = null;
          hasBeenOpen.current = false;
          forceRender((version) => version + 1);
        }
      }}
    >
      {children}
    </div>
  );
}
