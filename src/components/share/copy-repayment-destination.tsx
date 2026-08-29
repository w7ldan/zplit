"use client";

import { useEffect, useRef, useState } from "react";
import { copyLabel, copyText, type CopyStatus } from "@/components/feedback/copy-text";

export function CopyRepaymentDestination({ identifier, name }: { identifier: string; name: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function copyIdentifier() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const nextStatus = await copyText(identifier, input.current);
    setStatus(nextStatus);
    timer.current = window.setTimeout(() => setStatus("idle"), 1800);
  }

  return (
    <div className="debtor-statement__destination-copy">
      <input
        ref={input}
        aria-label={`${name} repayment details`}
        readOnly
        value={identifier}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        className="action-link action-link--quiet"
        type="button"
        onClick={copyIdentifier}
        aria-label={copyLabel(status, `Copy ${name} repayment details`)}
      >
        {copyLabel(status, "Copy")}
      </button>
    </div>
  );
}
