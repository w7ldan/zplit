"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type RecordConfirmationProps = {
  queryKey: "created" | "updated" | "splitSaved" | "saved";
  message: string;
  focusTargetId?: string;
};

function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

type ConfirmationPhase = "entering" | "visible" | "exiting" | "unmounted";

const confirmationExitMs = 220;

export function RecordConfirmation({ queryKey, message, focusTargetId }: RecordConfirmationProps) {
  const router = useOptionalRouter();
  const [phase, setPhase] = useState<ConfirmationPhase>("entering");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(queryKey);
    router?.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    if (focusTargetId) document.getElementById(focusTargetId)?.focus({ preventScroll: true });
    const enterTimer = window.setTimeout(() => setPhase("visible"), 0);
    const visibleTimer = window.setTimeout(() => setPhase("exiting"), 4000);
    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(visibleTimer);
    };
  }, [focusTargetId, queryKey, router]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const exitTimer = window.setTimeout(() => setPhase("unmounted"), reduced ? 0 : confirmationExitMs + 40);
    return () => window.clearTimeout(exitTimer);
  }, [phase]);

  if (phase === "unmounted") return null;

  return <p
    className={`record-confirmation record-confirmation--${phase}`}
    role="status"
    aria-live="polite"
    onTransitionEnd={(event) => {
      if (phase === "exiting" && event.target === event.currentTarget) setPhase("unmounted");
    }}
  >{message}</p>;
}
