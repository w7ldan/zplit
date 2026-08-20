import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootLayout, { themeBootstrap } from "@/app/layout";
import { ThemeControl, ThemeProvider } from "./theme-provider";

const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

function memoryStorage(value: string | null, unavailable = false) {
  return {
    getItem: unavailable ? vi.fn(() => { throw new Error("storage unavailable"); }) : vi.fn(() => value),
    setItem: unavailable ? vi.fn(() => { throw new Error("storage unavailable"); }) : vi.fn((_key: string, next: string) => { value = next; }),
  };
}

function installMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() { return matches; },
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    change(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => media) });
  return media;
}

function renderTheme(storage: ReturnType<typeof memoryStorage>, systemDark = false) {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  const media = installMedia(systemDark);
  document.head.innerHTML = '<meta name="theme-color" content="#F4F1EA">';
  render(<ThemeProvider><ThemeControl /></ThemeProvider>);
  return media;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.cssText = "";
  if (storageDescriptor) Object.defineProperty(window, "localStorage", storageDescriptor);
  vi.unstubAllGlobals();
});

describe("theme controller", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
  });

  it("defaults to system and resolves the operating-system preference", async () => {
    const storage = memoryStorage(null);
    renderTheme(storage, true);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("system");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#171816");
  });

  it.each([["light", false], ["dark", true]] as const)("honors stored %s preference", async (preference, systemDark) => {
    renderTheme(memoryStorage(preference), systemDark);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe(preference));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue(preference);
  });

  it("updates the DOM and storage when the preference changes", async () => {
    const storage = memoryStorage(null);
    renderTheme(storage);
    const control = screen.getByRole("combobox", { name: "Theme" });

    fireEvent.change(control, { target: { value: "dark" } });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storage.setItem).toHaveBeenCalledWith("zplit-theme", "dark");
    expect(control).toHaveValue("dark");
  });

  it("follows system changes only while System is selected", async () => {
    const media = renderTheme(memoryStorage("system"), true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    media.change(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), { target: { value: "dark" } });
    media.change(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it("falls back safely for malformed or unavailable storage", async () => {
    const malformed = renderTheme(memoryStorage("neon"), true);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveValue("system");

    malformed.change(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    renderTheme(memoryStorage(null, true));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(() => fireEvent.change(screen.getAllByRole("combobox", { name: "Theme" })[1], { target: { value: "dark" } })).not.toThrow();
  });

  it("keeps the bootstrap before body content and defines the dark token contract", () => {
    expect(themeBootstrap).toContain("zplit-theme");
    expect(themeBootstrap).toContain("prefers-color-scheme: dark");
    expect(themeBootstrap).toContain('d==="dark"?"#171816":"#F4F1EA"');
    const root = RootLayout({ children: <span>content</span> }) as ReactElement<{ children: ReactElement[] }>;
    const [head, body] = root.props.children;
    expect(head.type).toBe("head");
    expect((head as ReactElement<{ children: ReactElement<{ id: string }> }>).props.children.props.id).toBe("zplit-theme-bootstrap");
    expect(body.type).toBe("body");
    const foundation = readFileSync(path.resolve(process.cwd(), "src/app/styles/00-foundation.css"), "utf8");
    for (const token of ["--ink", "--paper", "--surface", "--muted-ink", "--rule", "--pastel-blue", "--mint", "--peach", "--amber", "--error", "--overlay", "--shadow"]) {
      expect(foundation).toMatch(new RegExp(`:root\\[data-theme=\\"dark\\"\\][\\s\\S]*${token}:`));
    }
  });
});
