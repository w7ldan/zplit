"use client";

import { useEffect } from "react";

type RecordConfirmationProps = {
  queryKey: "created" | "saved";
  message: string;
};

export function RecordConfirmation({ queryKey, message }: RecordConfirmationProps) {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(queryKey);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [queryKey]);

  return <p className="record-confirmation" role="status" aria-live="polite">{message}</p>;
}
