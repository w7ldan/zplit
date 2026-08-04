import { render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./service-worker-registration";

const workerSource = readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8");

describe("service worker registration", () => {
  it("cleans stale Zplit workers in development and unregisters on cleanup", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi.fn().mockResolvedValue([
      { active: { scriptURL: `${window.location.origin}/sw.js` }, waiting: null, installing: null, unregister },
      { active: { scriptURL: `${window.location.origin}/other.js` }, waiting: null, installing: null, unregister: vi.fn() },
    ]);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistrations } });

    const view = render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    view.unmount();
    expect(getRegistrations).toHaveBeenCalledOnce();
  });

  it("registers production workers after hydration with the root scope", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });

    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
    vi.unstubAllEnvs();
  });
});

describe("service worker policy", () => {
  it("keeps the allowlist, denylist, navigation fallback, and update policy explicit", () => {
    for (const pathName of ["/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png", "/icons/apple-touch-icon.png", "/_next/static/"]) expect(workerSource).toContain(pathName);
    for (const pathName of ["/app", "/api", "/join", "/share", "/receipts", "/exports"]) expect(workerSource).toContain(pathName);
    expect(workerSource).toContain('request.mode === "navigate"');
    expect(workerSource).toContain('caches.match("/offline")');
    expect(workerSource).toContain('keys.filter((key) => key.startsWith("zplit-")');
    expect(workerSource).not.toContain("skipWaiting");
    expect(workerSource).toContain('request.method !== "GET"');
    expect(workerSource).toContain("private|no-store");
  });

  it("returns the public offline page only after a navigation network failure", async () => {
    const listeners = loadWorker({
      caches: { match: vi.fn().mockResolvedValue("offline response") },
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const respondWith = vi.fn();
    listeners.fetch({ request: { method: "GET", mode: "navigate", url: "https://zplit.test/app", headers: new Headers() }, respondWith });

    await expect(respondWith.mock.calls[0][0]).resolves.toBe("offline response");
    expect(respondWith).toHaveBeenCalledOnce();
  });

  it("deletes only older Zplit caches during activation", async () => {
    const deleted = vi.fn().mockResolvedValue(true);
    const waitUntil = vi.fn();
    const listeners = loadWorker({
      caches: { keys: vi.fn().mockResolvedValue(["zplit-static-v0", "zplit-static-v1", "other-cache"]), delete: deleted },
    });
    listeners.activate({ waitUntil });

    await waitUntil.mock.calls[0][0];
    expect(deleted).toHaveBeenCalledWith("zplit-static-v0");
    expect(deleted).not.toHaveBeenCalledWith("zplit-static-v1");
    expect(deleted).not.toHaveBeenCalledWith("other-cache");
  });
});

function loadWorker({ caches, fetch = vi.fn() }: { caches: Record<string, unknown>; fetch?: ReturnType<typeof vi.fn> }) {
  const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
  const context = {
    URL,
    Promise,
    Set,
    Headers,
    fetch,
    caches,
    self: {
      location: { origin: "https://zplit.test" },
      addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => { listeners[type] = listener; },
    },
  };
  vm.runInNewContext(workerSource, context);
  return listeners;
}
