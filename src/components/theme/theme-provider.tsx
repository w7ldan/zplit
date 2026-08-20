"use client";

import { createContext, useContext, useEffect, useState, type ChangeEvent, type ReactNode } from "react";

export const THEME_STORAGE_KEY = "zplit-theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const themeColors: Record<ResolvedTheme, string> = {
  light: "#F4F1EA",
  dark: "#211F1D",
};

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function readThemePreference(storage?: Pick<Storage, "getItem"> | null): ThemePreference {
  try {
    const target = storage === undefined && typeof window !== "undefined" ? window.localStorage : storage;
    const value = target?.getItem(THEME_STORAGE_KEY) ?? null;
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function systemDark() {
  try {
    return window.matchMedia(THEME_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

export function applyTheme(preference: ThemePreference, systemIsDark = systemDark()): ResolvedTheme {
  const resolved = resolveTheme(preference, systemIsDark);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[resolved]);
  return resolved;
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolvedTheme: "light",
  setPreference: () => undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"));

  useEffect(() => {
    const stored = readThemePreference();
    if (stored !== preference) {
      setPreferenceState(stored);
      return;
    }

    const media = preference === "system" ? window.matchMedia?.(THEME_MEDIA_QUERY) : undefined;
    const update = () => setResolvedTheme(applyTheme(preference, media?.matches ?? false));
    update();
    if (preference !== "system" || !media) return;
    const handleChange = () => update();
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, [preference]);

  function setPreference(next: ThemePreference) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The DOM still follows the selection when storage is unavailable.
    }
    setPreferenceState(next);
    setResolvedTheme(applyTheme(next, systemDark()));
  }

  return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}

export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => setPreference(event.target.value as ThemePreference);

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select aria-label="Theme" value={preference} onChange={handleChange}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
