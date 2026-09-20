"use client";

import { useEffect, type RefObject } from "react";

export function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, fieldErrors: Record<string, string | undefined>) {
  const errorSignature = Object.values(fieldErrors).filter(Boolean).join("\u0000");

  useEffect(() => {
    if (!errorSignature) return;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [errorSignature, formRef]);
}
