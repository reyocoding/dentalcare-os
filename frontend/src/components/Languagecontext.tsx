import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { translations } from "./Translations";
import type { Language, TranslationKey } from "./Translations";

// ─── Context shape ────────────────────────────────────────────────────────────
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
  dir: "ltr" | "rtl";
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // Persist preference across sessions. Validate the stored value --
    // an invalid one (e.g. "es" from an old build) would make
    // translations[language] undefined and t() would throw during render.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("dental_language");
    } catch {
      stored = null;
    }
    return stored === "en" || stored === "fr" || stored === "ar" ? stored : "en";
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("dental_language", lang);
  };

  // Translate a key — falls back to English, then to the key itself
  const t = (key: TranslationKey): string => {
    const lang = translations[language] as Record<string, string>;
    const eng = translations.en as Record<string, string>;
    return (
      lang[key] ??
      eng[key] ??
      (key as string)
    );
  };

  const isRTL = language === "ar";
  const dir: "ltr" | "rtl" = isRTL ? "rtl" : "ltr";

  // Keep the <html> element in sync so CSS :dir selectors and browser
  // behaviour work correctly (e.g. scroll-bars flip automatically)
  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", language);
  }, [language, dir]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useLanguage = (): LanguageContextType => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
};