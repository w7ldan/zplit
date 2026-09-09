"use client";

import { startTransition, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

type InlineDisclosureProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  children: ReactNode;
};

const disclosureExitMs = 240;

export function InlineDisclosure({ open, children, className, onTransitionEnd, ...props }: InlineDisclosureProps) {
  const [present, setPresent] = useState(open);
  const exitTimer = useRef<number | null>(null);
  const visible = open || present;
  const closing = !open && visible;

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    if (open || !present) {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
      if (open && !present) startTransition(() => setPresent(true));
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setPresent(false);
    }, reduced ? 0 : disclosureExitMs);
    return () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    };
  }, [open, present]);

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
          setPresent(false);
        }
      }}
    >
      {children}
    </div>
  );
}
