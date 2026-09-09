"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

type InlineDisclosureProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  children: ReactNode;
};

const disclosureExitMs = 240;

export function InlineDisclosure({ open, children, className, onTransitionEnd, ...props }: InlineDisclosureProps) {
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    if (open) {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresent(true);
      setClosing(false);
      return;
    }
    if (!present) return;
    setClosing(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setPresent(false);
      setClosing(false);
    }, reduced ? 1 : disclosureExitMs);
  }, [open, present]);

  if (!present) return null;

  return (
    <div
      {...props}
      className={[className, closing ? "inline-disclosure--closing" : ""].filter(Boolean).join(" ")}
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
          setClosing(false);
        }
      }}
    >
      {children}
    </div>
  );
}
