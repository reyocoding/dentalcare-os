import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

// ─── Clinic-wide preferences ────────────────────────────────────────────────
// collisionCheck: when ON, booking a session refuses/prefers slots that
// overlap other patients' appointments. Default OFF because a clinic may run
// more than one office/operator off the same calendar.
// currency: the symbol/unit used everywhere money is shown ($, £, DZD, ...).

export interface CurrencyOption {
  code: string;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "DZD", symbol: "DZD", label: "Algerian Dinar" },
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "TND", symbol: "DT", label: "Tunisian Dinar" },
  { code: "MAD", symbol: "DH", label: "Moroccan Dirham" },
  { code: "SAR", symbol: "SR", label: "Saudi Riyal" },
  { code: "AED", symbol: "AED", label: "UAE Dirham" },
  { code: "QAR", symbol: "QR", label: "Qatari Riyal" },
  { code: "EGP", symbol: "EGP", label: "Egyptian Pound" },
  { code: "TRY", symbol: "₺", label: "Turkish Lira" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan" },
];

export interface ClinicSettings {
  collisionCheck: boolean;
  currency: { code: string; symbol: string };
}

const DEFAULTS: ClinicSettings = {
  collisionCheck: false,
  currency: { code: "DZD", symbol: "DZD" },
};

const STORAGE_KEY = "dental_clinic_settings";

function loadSettings(): ClinicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ClinicSettings>;
    return {
      collisionCheck: typeof parsed.collisionCheck === "boolean" ? parsed.collisionCheck : DEFAULTS.collisionCheck,
      currency: parsed.currency && typeof parsed.currency.symbol === "string"
        ? { code: parsed.currency.code ?? "CUSTOM", symbol: parsed.currency.symbol }
        : DEFAULTS.currency,
    };
  } catch {
    return DEFAULTS;
  }
}

interface ClinicSettingsContextType extends ClinicSettings {
  setCollisionCheck: (on: boolean) => void;
  setCurrency: (currency: { code: string; symbol: string }) => void;
  formatMoney: (amount: number) => string;
}

const ClinicSettingsContext = createContext<ClinicSettingsContextType | null>(null);

export const ClinicSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<ClinicSettings>(loadSettings);

  const persist = (next: ClinicSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage restricted -- setting just won't survive a reload.
    }
  };

  return (
    <ClinicSettingsContext.Provider
      value={{
        collisionCheck: settings.collisionCheck,
        currency: settings.currency,
        setCollisionCheck: (on) => persist({ ...settings, collisionCheck: on }),
        setCurrency: (currency) => persist({ ...settings, currency }),
        formatMoney: (amount) => {
          const n = Number.isFinite(amount) ? amount : 0;
          return `${settings.currency.symbol} ${n.toLocaleString()}`;
        },
      }}
    >
      {children}
    </ClinicSettingsContext.Provider>
  );
};

export const useClinicSettings = (): ClinicSettingsContextType => {
  const ctx = useContext(ClinicSettingsContext);
  if (!ctx) throw new Error("useClinicSettings must be used inside <ClinicSettingsProvider>");
  return ctx;
};
