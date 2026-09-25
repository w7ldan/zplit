"use client";

import { useEffect, useRef } from "react";

export function useActiveContextNavigation(pathname: string) {
  const navigationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const activeItem = navigationRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );

    if (activeItem && typeof activeItem.scrollIntoView === "function") {
      activeItem.scrollIntoView({
        behavior: "instant",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [pathname]);

  return navigationRef;
}
