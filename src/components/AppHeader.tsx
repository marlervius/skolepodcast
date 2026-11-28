"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_KEY = "lytterom_theme_v1";
type Theme = "light" | "dark";

export function Logo() {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--terracotta)" />
      <path d="M10 9v14h12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 15.5a3.5 3.5 0 0 1 3.5 3.5M16 11.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

export function AppHeader() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    setTheme(stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Lagring kan være blokkert. */ }
  }

  const studio = pathname.startsWith("/studio");
  const mineFag = pathname === "/mine-fag" || pathname.startsWith("/fag/");

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="Lytterom – til forsiden">
          <Logo />
          <span>Lytterom</span>
        </Link>
        <nav className="app-nav" aria-label="Hovedmeny">
          <Link href="/mine-fag" aria-current={mineFag ? "page" : undefined}>Mine fag</Link>
          <Link href="/studio" className={!studio ? "nav-subtle" : undefined} aria-current={studio ? "page" : undefined}>
            {studio ? "Lærerstudio" : "For lærere"}
          </Link>
          <button type="button" className="icon-button" onClick={toggle} aria-label={theme === "dark" ? "Bytt til lys modus" : "Bytt til mørk modus"}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </nav>
      </div>
    </header>
  );
}
