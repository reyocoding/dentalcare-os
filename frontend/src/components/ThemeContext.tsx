import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

export type ThemeId = string; // preset id or "custom"
export type FontSize = "small" | "medium" | "large";

export interface ThemeColors {
  bg: string; bgCard: string; bgSidebar: string; bgInput: string;
  text: string; textSecondary: string; textMuted: string;
  border: string; accent: string; accentHover: string; accentText: string;
  danger: string; dangerBg: string; success: string; successBg: string;
  warning: string; warningBg: string;
  sidebarText: string; sidebarActive: string; cardShadow: string;
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  colors: ThemeColors;
}

function full(t: Partial<ThemeColors>): ThemeColors {
  return {
    bg: t.bg!, bgCard: t.bgCard!, bgSidebar: t.bgSidebar || t.bgCard!,
    bgInput: t.bgInput || t.bg!,
    text: t.text!, textSecondary: t.textSecondary!, textMuted: t.textMuted!,
    border: t.border!, accent: t.accent!, accentHover: t.accentHover!,
    accentText: "#ffffff",
    danger: t.danger || "#ef4444", dangerBg: t.dangerBg || "#fef2f2",
    success: t.success || "#16a34a", successBg: t.successBg || "#f0fdf4",
    warning: t.warning || "#d97706", warningBg: t.warningBg || "#fefce8",
    sidebarText: t.sidebarText || t.textSecondary!,
    sidebarActive: t.sidebarActive || t.accentHover!,
    cardShadow: t.cardShadow || "rgba(0,0,0,0.05)",
  };
}

const LIGHT    = full({ bg:"#f8fafc", bgCard:"#ffffff", bgInput:"#f8fafc", text:"#0f172a", textSecondary:"#64748b", textMuted:"#94a3b8", border:"#e2e8f0", accent:"#2563eb", accentHover:"#eff6ff" });
const CREAM    = full({ bg:"#faf8f5", bgCard:"#ffffff", bgInput:"#f5f3ef", text:"#292524", textSecondary:"#78716c", textMuted:"#a8a29e", border:"#e7e5e4", accent:"#d97706", accentHover:"#fffbeb", sidebarText:"#78716c", cardShadow:"rgba(0,0,0,0.05)" });
const FOREST   = full({ bg:"#f0f7f2", bgCard:"#ffffff", bgInput:"#e8f2ec", text:"#1a2e22", textSecondary:"#5b7b6a", textMuted:"#8ba89a", border:"#d4e4da", accent:"#2d8f5e", accentHover:"#e6f5ec", danger:"#dc2626", success:"#16a34a", sidebarText:"#5b7b6a", cardShadow:"rgba(0,0,0,0.05)" });
const ROSE     = full({ bg:"#fdf2f4", bgCard:"#ffffff", bgInput:"#fce8ec", text:"#2d1b1e", textSecondary:"#8b6b72", textMuted:"#b8959e", border:"#f0dce2", accent:"#d9467a", accentHover:"#fce8f0", danger:"#dc2626", success:"#16a34a", sidebarText:"#8b6b72", cardShadow:"rgba(0,0,0,0.05)" });
const DARK     = full({ bg:"#0f172a", bgCard:"#1e293b", bgInput:"#1e293b", text:"#f1f5f9", textSecondary:"#94a3b8", textMuted:"#64748b", border:"#334155", accent:"#3b82f6", accentHover:"#1e3a5f", danger:"#f87171", dangerBg:"#451a1a", success:"#4ade80", successBg:"#14532d", warning:"#fbbf24", warningBg:"#451a03", sidebarText:"#94a3b8", cardShadow:"rgba(0,0,0,0.2)" });
const MIDNIGHT = full({ bg:"#0c0a1d", bgCard:"#1a1735", bgInput:"#1a1735", text:"#e8e6f0", textSecondary:"#9d99b8", textMuted:"#6b6790", border:"#2e2a50", accent:"#7c3aed", accentHover:"#2e1065", danger:"#f87171", dangerBg:"#451a1a", success:"#4ade80", successBg:"#14532d", warning:"#fbbf24", warningBg:"#451a03", sidebarText:"#9d99b8", cardShadow:"rgba(0,0,0,0.3)" });
const CHARCOAL = full({ bg:"#141414", bgCard:"#222222", bgInput:"#222222", text:"#ece8e0", textSecondary:"#9a9286", textMuted:"#6e665a", border:"#333333", accent:"#d97706", accentHover:"#2a2000", danger:"#f87171", dangerBg:"#451a1a", success:"#4ade80", successBg:"#14532d", warning:"#fbbf24", warningBg:"#451a03", sidebarText:"#9a9286", cardShadow:"rgba(0,0,0,0.3)" });
const OCEAN    = full({ bg:"#0a1a20", bgCard:"#142830", bgInput:"#142830", text:"#dceef5", textSecondary:"#7aacbf", textMuted:"#4a7a8f", border:"#1e3a45", accent:"#0ea5e9", accentHover:"#082a38", danger:"#f87171", dangerBg:"#451a1a", success:"#4ade80", successBg:"#14532d", warning:"#fbbf24", warningBg:"#451a03", sidebarText:"#7aacbf", cardShadow:"rgba(0,0,0,0.3)" });

export const THEMES: ThemeDef[] = [
  { id:"light",    label:"Light",    mode:"light", colors:LIGHT },
  { id:"cream",    label:"Cream",    mode:"light", colors:CREAM },
  { id:"forest",   label:"Forest",   mode:"light", colors:FOREST },
  { id:"rose",     label:"Rose",     mode:"light", colors:ROSE },
  { id:"dark",     label:"Dark",     mode:"dark",  colors:DARK },
  { id:"midnight", label:"Midnight", mode:"dark",  colors:MIDNIGHT },
  { id:"charcoal", label:"Charcoal", mode:"dark",  colors:CHARCOAL },
  { id:"ocean",    label:"Ocean",    mode:"dark",  colors:OCEAN },
];

export const FONT_OPTIONS = [
  { id:"system",   label:"System Default",   stack:"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { id:"inter",    label:"Inter",            stack:"'Inter', -apple-system, sans-serif" },
  { id:"nunito",   label:"Nunito",           stack:"'Nunito', -apple-system, sans-serif" },
  { id:"serif",    label:"Serif",            stack:"Georgia, 'Times New Roman', serif" },
  { id:"mono",     label:"Monospace",        stack:"'JetBrains Mono', 'Fira Code', monospace" },
];

interface FontSettings {
  familyId: string;
  bodySize: number;   // px 12-20
  headingSize: number; // px 16-32
}

interface ThemeContextType {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  customColors: Partial<ThemeColors>;
  setCustomColors: (c: Partial<ThemeColors>) => void;
  colors: ThemeColors;
  currentTheme: ThemeDef;
  font: FontSettings;
  setFont: (f: FontSettings) => void;
}

const ctxDefault = {
  familyId: "system",
  bodySize: 16,
  headingSize: 20,
};

function loadFont(): FontSettings {
  try {
    const raw = localStorage.getItem("dental_font");
    if (raw) return { ...ctxDefault, ...JSON.parse(raw) };
  } catch {}
  return ctxDefault;
}

function loadCustomColors(): Partial<ThemeColors> {
  try {
    const raw = localStorage.getItem("dental_custom_theme");
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const VALID_THEME_IDS = new Set<string>([...THEMES.map(t => t.id), "custom"]);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    // Guard storage access (can throw when restricted) and validate the
    // persisted id -- an unknown one leaves no [data-theme] rule matching.
    try {
      const stored = localStorage.getItem("dental_theme");
      return stored && VALID_THEME_IDS.has(stored) ? stored : "light";
    } catch {
      return "light";
    }
  });
  const [customColors, setCustomColorsState] = useState<Partial<ThemeColors>>(loadCustomColors);
  const [font, setFontState] = useState<FontSettings>(loadFont);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem("dental_theme", t);
  }, []);

  const setCustomColors = useCallback((c: Partial<ThemeColors>) => {
    setCustomColorsState(c);
    localStorage.setItem("dental_custom_theme", JSON.stringify(c));
    if (theme === "custom") {
      // trigger re-render
    }
  }, [theme]);

  const setFont = useCallback((f: FontSettings) => {
    setFontState(f);
    localStorage.setItem("dental_font", JSON.stringify(f));
  }, []);

  let currentTheme: ThemeDef;
  if (theme === "custom") {
    const c = full({ ...THEMES[0].colors, ...customColors });
    // Luminance-based, not equality-with-light -- a bg tweak shouldn't
    // silently flip the "mode" label to dark.
    const [r, g, b] = c.bg.slice(1).match(/../g)!.map(h => parseInt(h, 16));
    const mode: "light" | "dark" = (0.299 * r + 0.587 * g + 0.114 * b) > 128 ? "light" : "dark";
    currentTheme = { id:"custom", label:"Custom", mode, colors: c };
  } else {
    currentTheme = THEMES.find(th => th.id === theme) || THEMES[0];
  }
  const colors = currentTheme.colors;

  // Sync data attributes to <html>
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  // Custom themes have no static [data-theme="custom"] block in App.css --
  // push the user's colors into CSS variables so var(--*) consumers
  // (sidebar, teeth chart, odontogram) follow the custom palette instead
  // of falling back to the light theme.
  useEffect(() => {
    const map: Record<keyof ThemeColors, string> = {
      bg: "--bg", bgCard: "--bg-card", bgSidebar: "--bg-sidebar", bgInput: "--bg-input",
      text: "--text", textSecondary: "--text-secondary", textMuted: "--text-muted",
      border: "--border", accent: "--accent", accentHover: "--accent-hover", accentText: "--accent-text",
      danger: "--danger", dangerBg: "--danger-bg", success: "--success", successBg: "--success-bg",
      warning: "--warning", warningBg: "--warning-bg",
      sidebarText: "--sidebar-text", sidebarActive: "--sidebar-active", cardShadow: "--card-shadow",
    };
    const el = document.documentElement;
    if (theme !== "custom") {
      // Inline styles outrank the static [data-theme="..."] rules -- make
      // sure preset themes aren't polluted by leftover custom values.
      for (const cssVar of Object.values(map)) el.style.removeProperty(cssVar);
      return;
    }
    for (const [key, cssVar] of Object.entries(map) as [keyof ThemeColors, string][]) {
      el.style.setProperty(cssVar, colors[key]);
    }
  }, [theme, colors]);
  useEffect(() => {
    document.documentElement.style.setProperty("--font-family", FONT_OPTIONS.find(f => f.id === font.familyId)?.stack || FONT_OPTIONS[0].stack);
    document.documentElement.style.fontSize = `${font.bodySize}px`;
    document.documentElement.style.setProperty("--body-font-size", `${font.bodySize}px`);
    document.documentElement.style.setProperty("--heading-font-size", `${font.headingSize}px`);
  }, [font]);

  // Load Google Fonts if needed
  useEffect(() => {
    const googleFonts: Record<string, string> = {
      inter: "Inter:wght@300..700",
      nunito: "Nunito:wght@300..700",
    };
    const gf = googleFonts[font.familyId];
    if (!gf) return;
    const id = `gf-${font.familyId}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;
    document.head.appendChild(link);
  }, [font.familyId]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, customColors, setCustomColors, colors, currentTheme, font, setFont }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
};
