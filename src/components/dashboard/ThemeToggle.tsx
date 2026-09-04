"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

export const THEME_KEY = "lectern.theme";

/**
 * Reads the stored choice, falling back to the OS preference. The inline
 * script in layout.tsx runs this same logic before first paint — change one
 * and you must change the other, or the page flashes the wrong theme.
 */
function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private mode or blocked storage: fall through to the OS preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The theme's home is the `dark` class on <html> — the inline script sets it
 * before React exists, so React reads it rather than owning it. The server
 * snapshot is always light, which matches the HTML the server sent.
 */
function subscribeToHtmlClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribeToHtmlClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembering the choice is survivable; not applying it is not.
    }
  }

  return (
    <button
      onClick={toggle}
      className="rounded-lg border border-line p-1.5 text-muted transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-soft"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
    >
      {isDark ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
    </button>
  );
}
