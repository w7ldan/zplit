"use client";

import { useRef, useState } from "react";
import { copyLabel, copyText, type CopyStatus } from "@/components/feedback/copy-text";

export function TripSummaryCopy({ text }: { text: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  return <>
    <textarea ref={fallbackRef} className="trip-summary-copy__fallback" readOnly value={text} aria-label="Trip summary copy fallback" tabIndex={-1} />
    <button className="action-link action-link--quiet" type="button" onClick={async () => setStatus(await copyText(text, fallbackRef.current))} aria-live="polite">{copyLabel(status, "Copy trip summary")}</button>
  </>;
}
