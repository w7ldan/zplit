"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function JoinedConfirmation({ active = false }: { active?: boolean }) {
  const router = useRouter();
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("joined") === "1") {
      url.searchParams.delete("joined");
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    }
  }, [active, router]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <p
      className="login-form__success"
      role="status"
      aria-live="polite"
      aria-hidden={visible ? undefined : true}
      style={{ visibility: visible ? "visible" : "hidden" }}
    >
      {visible ? "Your account is ready. Sign in to open your ledger." : null}
    </p>
  );
}
