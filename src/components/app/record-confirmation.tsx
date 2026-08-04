"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RecordConfirmationProps = {
  queryKey: "created" | "saved";
  message: string;
};

function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function RecordConfirmation({ queryKey, message }: RecordConfirmationProps) {
  const router = useOptionalRouter();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(queryKey);
    router?.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    const timer = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [queryKey, router]);

  return <p className={visible ? "record-confirmation" : "record-confirmation record-confirmation--hidden"} role="status" aria-live="polite" aria-hidden={visible ? undefined : true}>{visible ? message : null}</p>;
}
