"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export const unsavedChangesMessage = "Discard unsaved changes?";

type UnsavedChangesContextValue = {
  setDirty: (id: string, dirty: boolean) => void;
  confirmDiscard: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

function currentLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function linkFromEvent(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || target.target === "_blank" || target.hasAttribute("download") || target.rel.includes("external")) return null;
  const url = new URL(target.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const href = `${url.pathname}${url.search}${url.hash}`;
  return href === currentLocation() ? null : href;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dirtyGuards = useRef(new Map<string, boolean>());
  const dirtyRef = useRef(false);
  const previousLocationRef = useRef("");
  const [dirtyRevision, setDirtyRevision] = useState(0);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirtyGuards.current.get(id) === dirty) return;
    dirtyGuards.current.set(id, dirty);
    dirtyRef.current = [...dirtyGuards.current.values()].some(Boolean);
    setDirtyRevision((revision) => revision + 1);
  }, []);

  const confirmDiscard = useCallback(() => !dirtyRef.current || window.confirm(unsavedChangesMessage), []);

  useEffect(() => {
    previousLocationRef.current = currentLocation();

    function handleClick(event: MouseEvent) {
      const href = linkFromEvent(event);
      if (!href || !dirtyRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmDiscard()) router.push(href);
    }

    function handlePopState() {
      const destination = currentLocation();
      const previous = previousLocationRef.current;
      if (!dirtyRef.current || !previous || destination === previous || confirmDiscard()) {
        previousLocationRef.current = destination;
        return;
      }
      router.replace(previous, { scroll: false });
    }

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [confirmDiscard, router]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyRevision]);

  const context = useMemo(() => ({ setDirty, confirmDiscard }), [confirmDiscard, setDirty]);
  return <UnsavedChangesContext.Provider value={context}>{children}</UnsavedChangesContext.Provider>;
}

export function useUnsavedChangesGuard(dirty: boolean) {
  const context = useContext(UnsavedChangesContext);
  const id = useId();

  useEffect(() => {
    if (!context) return;
    context.setDirty(id, dirty);
    return () => context.setDirty(id, false);
  }, [context, dirty, id]);
}

export function useUnsavedChangesNavigation() {
  return useContext(UnsavedChangesContext);
}
