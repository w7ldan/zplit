"use client";

import { useEffect } from "react";

function isZplitWorker(registration: ServiceWorkerRegistration) {
  return [registration.active, registration.waiting, registration.installing].some((worker) => {
    if (!worker) return false;
    try {
      return new URL(worker.scriptURL).pathname === "/sw.js";
    } catch {
      return false;
    }
  });
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    let cancelled = false;
    if (!("serviceWorker" in navigator)) return () => { cancelled = true; };

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        if (cancelled) return;
        return Promise.all(registrations.filter(isZplitWorker).map((registration) => registration.unregister()));
      }).catch((error: unknown) => {
        if (!cancelled) console.warn("Zplit service worker cleanup failed", error);
      });
      return () => { cancelled = true; };
    }

    void navigator.serviceWorker.register("/sw.js?v=2", { scope: "/" }).catch((error: unknown) => {
      if (!cancelled && process.env.NODE_ENV !== "production") console.warn("Zplit service worker registration failed", error);
    });
    return () => { cancelled = true; };
  }, []);

  return null;
}
