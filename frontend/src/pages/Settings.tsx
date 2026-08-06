import { useState } from "react";
import {
  Globe,
  Check,
  Palette,
  Info,
  Download,
  Users,
  Calendar,
  DollarSign,
  ChevronRight,
  Edit3,
  CalendarClock,
  Banknote,
} from "lucide-react";
import { useLanguage } from "../components/Languagecontext";
import { useTheme, THEMES } from "../components/ThemeContext";
import { useClinicSettings, CURRENCIES } from "../components/ClinicSettings";
import type { Language } from "../components/Translations";
import { api } from "../services/api"; // adjust path to match your project

// ─── Language options ─────────────────────────────────────────────────────────
const LANGUAGES: {
  code: Language;
  nativeLabel: string;
  englishLabel: string;
  flag: string;
}[] = [
  { code: "en", nativeLabel: "English",  englishLabel: "English",  flag: "🇬🇧" },
  { code: "fr", nativeLabel: "Français", englishLabel: "French",   flag: "🇫🇷" },
  { code: "ar", nativeLabel: "العربية",  englishLabel: "Arabic",   flag: "🇩🇿" },
];

// ─── Small shared card wrapper ────────────────────────────────────────────────
const Section = ({
  icon,
  iconBg,
  
  title,
  subtitle,
  children,
  badge,
  colors,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
  badge?: string;
  colors: any;
}) => (
  <div
    style={{
      background: colors.bgCard,
      border: `1px solid ${colors.border}`,
      borderRadius: "14px",
      overflow: "hidden",
      marginBottom: "16px",
    }}
  >
    {/* Header row */}
    <div
      style={{
        padding: "20px 24px",
        borderBottom: children ? `1px solid ${colors.border}` : "none",
        display: "flex",
        alignItems: "center",
        gap: "14px",
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "10px",
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>
          {title}
        </div>
        <div style={{ fontSize: "13px", color: colors.textSecondary, marginTop: "2px" }}>
          {subtitle}
        </div>
      </div>
      {badge && (
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            background: colors.bgInput,
            color: colors.textMuted,
            padding: "4px 10px",
            borderRadius: "999px",
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </div>

    {children && <div style={{ padding: "16px 24px" }}>{children}</div>}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
const Settings = () => {
  const { language, setLanguage, t, isRTL } = useLanguage();
  const { theme, setTheme, customColors, setCustomColors, colors, currentTheme, font, setFont } = useTheme();
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  // ── Language change ──────────────────────────────────────────────────────
  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // ── Clinic scheduling preferences ─────────────────────────────────────────
  const { collisionCheck, setCollisionCheck, currency, setCurrency } = useClinicSettings();
  const [customSymbol, setCustomSymbol] = useState(
    CURRENCIES.some((c) => c.code === currency.code) ? "" : currency.symbol
  );

  // ── CSV export helpers ───────────────────────────────────────────────────
  const downloadCSV = (rows: string[][], filename: string) => {
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Arabic
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on a tick -- revoking synchronously aborts the download in
    // some browsers (notably Firefox).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportPatients = async () => {
    setExporting("patients");
    try {
      const total = await api.getPatientsCount();
      const patients: import("../services/api").Patient[] = [];
      for (let skip = 0; skip < total; skip += 100) {
        patients.push(...(await api.getPatients(skip, 100)));
      }
      const headers = [
        "ID", "First Name", "Last Name", "Gender", "Date of Birth",
        "Phone", "Email", "Address", "Occupation",
        "Allergies", "Current Medications", "Medical History",
        "Emergency Contact", "Emergency Phone", "Notes", "Registered",
      ];
      const rows = patients.map((p) => [
        p.id, p.first_name, p.last_name, p.gender ?? "",
        p.date_of_birth ?? "", p.phone_number ?? "", p.email ?? "",
        p.address ?? "", p.occupation ?? "", p.allergies ?? "",
        p.current_medications ?? "", p.medical_history ?? "",
        p.emergency_contact_name ?? "", p.emergency_contact_phone ?? "",
        p.notes ?? "", new Date(p.created_at).toLocaleDateString(),
      ]);
      downloadCSV([headers, ...rows.map(r => r.map(String))], "patients_export.csv");
    } catch {
      alert("Failed to export patients.");
    } finally {
      setExporting(null);
    }
  };

  const exportAppointments = async () => {
    setExporting("appointments");
    try {
      const [apts, patients] = await Promise.all([
        api.getAllAppointments(),
        (async () => {
          const total = await api.getPatientsCount();
          const all: import("../services/api").Patient[] = [];
          for (let skip = 0; skip < total; skip += 100) {
            all.push(...(await api.getPatients(skip, 100)));
          }
          return all;
        })(),
      ]);
      const patientMap = Object.fromEntries(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
      const headers = [
        "ID", "Patient", "Date & Time", "Duration (min)",
        "Status", "Reason", "Session #", "Notes",
      ];
      const rows = apts.map((a) => [
        a.id,
        patientMap[a.patient_id] ?? `Patient #${a.patient_id}`,
        new Date(a.appointment_datetime).toLocaleString(),
        a.duration_minutes,
        a.status,
        a.reason ?? "",
        a.session_number ?? "",
        a.notes ?? "",
      ]);
      downloadCSV([headers, ...rows.map(r => r.map(String))], "appointments_export.csv");
    } catch {
      alert("Failed to export appointments.");
    } finally {
      setExporting(null);
    }
  };

  const exportFinancials = async () => {
    setExporting("financials");
    try {
      const [payments, patients] = await Promise.all([
        api.getPayments(),
        (async () => {
          const total = await api.getPatientsCount();
          const all: import("../services/api").Patient[] = [];
          for (let skip = 0; skip < total; skip += 100) {
            all.push(...(await api.getPatients(skip, 100)));
          }
          return all;
        })(),
      ]);
      const patientMap = Object.fromEntries(patients.map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
      const headers = [
        "ID", "Patient", "Date", "Description", "Method",
        "Amount", "Discount", "Status", "Invoice #",
      ];
      const rows = payments.map((p) => [
        p.id,
        patientMap[p.patient_id] ?? `Patient #${p.patient_id}`,
        new Date(p.payment_date).toLocaleDateString(),
        p.description ?? "",
        p.method,
        p.amount.toFixed(2),
        p.discount.toFixed(2),
        p.status,
        p.invoice_number ?? "",
      ]);
      downloadCSV([headers, ...rows.map(r => r.map(String))], "financials_export.csv");
    } catch {
      alert("Failed to export financials.");
    } finally {
      setExporting(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "32px", maxWidth: "680px", margin: "0 auto" }}>
      {/* Page title */}
      <h2 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700, color: colors.text }}>
        {t("set_title")}
      </h2>
      <p style={{ margin: "0 0 28px", color: colors.textSecondary, fontSize: "14px" }}>
        {t("set_subtitle")}
      </p>

      {/* ── Saved toast ── */}
      {saved && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            background: colors.successBg, border: `1px solid ${colors.success}40`,
            borderRadius: "10px", padding: "12px 16px", marginBottom: "20px",
            color: colors.success, fontWeight: 600, fontSize: "14px",
          }}
        >
          <Check size={16} /> {t("set_saved")}
        </div>
      )}

      {/* ══════════════ LANGUAGE ══════════════ */}
      <Section
        colors={colors}
        icon={<Globe size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_language")}
        subtitle={t("set_language_desc")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {LANGUAGES.map((lang) => {
            const isActive = language === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  border: isActive ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  background: isActive ? colors.accentHover : colors.bgInput,
                  transition: "all 0.15s ease",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "26px", lineHeight: 1 }}>{lang.flag}</span>
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "14px",
                        color: isActive ? colors.accent : colors.text,
                      }}
                    >
                      {lang.nativeLabel}
                    </div>
                    {lang.nativeLabel !== lang.englishLabel && (
                      <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: "1px" }}>
                        {lang.englishLabel}
                      </div>
                    )}
                  </div>
                </div>
                {isActive && (
                  <div
                    style={{
                      width: 24, height: 24, borderRadius: "50%",
                      background: colors.accent,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Check size={14} color={colors.accentText} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* RTL notice */}
        {isRTL && (
          <div
            style={{
              marginTop: "14px",
              padding: "12px 14px",
              background: colors.warningBg,
              border: `1px solid ${colors.warning}`,
              borderRadius: "8px",
              fontSize: "13px",
              color: colors.warning,
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
            }}
          >
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{t("set_rtl_notice")}</span>
          </div>
        )}
      </Section>

      {/* ══════════════ SCHEDULING ══════════════ */}
      <Section
        colors={colors}
        icon={<CalendarClock size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_scheduling")}
        subtitle={t("set_scheduling_desc")}
      >
        {/* Slot collision check */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "14px 16px",
            background: colors.bgInput,
            borderRadius: "10px",
            border: `1px solid ${colors.border}`,
          }}
        >
          <input
            type="checkbox"
            id="collision-check"
            checked={collisionCheck}
            onChange={(e) => setCollisionCheck(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: "pointer" }}
          />
          <label htmlFor="collision-check" style={{ cursor: "pointer", flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: colors.text }}>
              {t("set_collision_check")}
            </div>
            <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
              {t("set_collision_check_desc")}
            </div>
          </label>
        </div>
      </Section>

      {/* ══════════════ CURRENCY ══════════════ */}
      <Section
        colors={colors}
        icon={<Banknote size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_currency")}
        subtitle={t("set_currency_desc")}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px" }}>
          {CURRENCIES.map((cur) => {
            const active = currency.code === cur.code;
            return (
              <button
                key={cur.code}
                onClick={() => setCurrency({ code: cur.code, symbol: cur.symbol })}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  padding: "10px 8px", borderRadius: "10px", cursor: "pointer",
                  border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  background: active ? colors.accentHover : colors.bgInput,
                  fontWeight: 600, fontSize: "13px",
                  color: active ? colors.accent : colors.text,
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: "16px", fontWeight: 700 }}>{cur.symbol}</span>
                <span style={{ fontSize: "11px", color: active ? colors.accent : colors.textSecondary }}>{cur.code}</span>
                {active && <Check size={12} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>

        {/* Custom symbol */}
        <div style={{ marginTop: "14px", padding: "12px 14px", background: colors.bgInput, borderRadius: "10px", border: `1px solid ${colors.border}` }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, marginBottom: "8px" }}>
            {t("set_custom_symbol")}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="text"
              value={customSymbol}
              onChange={(e) => {
                setCustomSymbol(e.target.value);
                const v = e.target.value.trim();
                if (v) setCurrency({ code: "CUSTOM", symbol: v });
              }}
              placeholder={t("set_custom_symbol_placeholder")}
              style={{
                flex: 1, padding: "9px 12px", borderRadius: "8px",
                border: `1px solid ${colors.border}`, fontSize: "14px",
                background: colors.bgCard, color: colors.text,
              }}
            />
            <span style={{ fontSize: "13px", color: colors.textSecondary, whiteSpace: "nowrap" }}>
              {t("set_currency_preview")}: <strong style={{ color: colors.accent }}>{currency.symbol} 12,500</strong>
            </span>
          </div>
        </div>
      </Section>

      {/* ══════════════ THEME ══════════════ */}
      <Section
        colors={colors}
        icon={<Palette size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_theme")}
        subtitle={t("set_theme_desc")}
      >
        {/* Color themes */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            {t("set_theme_mode")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {THEMES.map(th => {
              const active = theme === th.id;
              return (
                <button key={th.id} onClick={() => setTheme(th.id)} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
                  border: active ? `2px solid ${th.colors.accent}` : `1px solid ${colors.border}`,
                  background: active ? th.colors.accentHover : colors.bgInput,
                  fontWeight: 600, fontSize: "12px",
                  color: active ? th.colors.accent : colors.text,
                  transition: "all 0.15s ease",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${th.colors.accent}, ${th.colors.bgCard})`,
                    border: `2px solid ${th.colors.border}`,
                  }} />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: "12px" }}>{th.label}</div>
                    <div style={{ fontSize: "10px", color: colors.textMuted }}>{th.mode === "light" ? t("set_theme_light") : t("set_theme_dark")}</div>
                  </div>
                  {active && <Check size={12} style={{ marginLeft: "auto", flexShrink: 0 }} color={th.colors.accent} />}
                </button>
              );
            })}
            {/* Custom */}
            <button onClick={() => setTheme("custom")} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
              border: theme === "custom" ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: theme === "custom" ? colors.accentHover : colors.bgInput,
              fontWeight: 600, fontSize: "12px",
              color: theme === "custom" ? colors.accent : colors.text,
              transition: "all 0.15s ease",
            }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: `conic-gradient(#2563eb, #d9467a, #d97706, #16a34a, #2563eb)`, border: `2px solid ${colors.border}` }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: "12px" }}>{t("set_custom")}</div>
                <div style={{ fontSize: "10px", color: colors.textMuted }}>{t("set_custom_desc")}</div>
              </div>
              {theme === "custom" && <Check size={12} style={{ marginLeft: "auto", flexShrink: 0 }} color={colors.accent} />}
            </button>
          </div>
        </div>
        {/* Custom theme builder */}
        {theme === "custom" && (
          <div style={{ marginBottom: 16, padding: "12px", background: colors.bgInput, borderRadius: "10px", border: `1px solid ${colors.border}` }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, marginBottom: 12 }}>{t("set_customize_colors")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {([
                { key: "accent" as const, label: "Accent" },
                { key: "bg" as const, label: "Background" },
                { key: "bgCard" as const, label: "Card" },
                { key: "text" as const, label: "Text" },
              ]).map(({ key, label }) => (
                <div key={key}>
                  <div style={{ fontSize: "11px", color: colors.textSecondary, marginBottom: 4 }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="color" value={customColors[key] || currentTheme.colors[key]} onChange={e => setCustomColors({ ...customColors, [key]: e.target.value })} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${colors.border}`, padding: 2, cursor: "pointer", background: "none" }} />
                    <input type="text" value={customColors[key] || currentTheme.colors[key]} onChange={e => {
                      // Only persist valid hex colors -- an empty/garbage
                      // value would be stored and break CSS on next load.
                      const v = e.target.value.trim();
                      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                        setCustomColors({ ...customColors, [key]: v });
                      }
                    }} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: `1px solid ${colors.border}`, fontSize: "11px", fontFamily: "monospace", background: colors.bgCard, color: colors.text }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ══════════════ FONTS ══════════════ */}
      <Section
        colors={colors}
        icon={<Edit3 size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_fonts_sizes")}
        subtitle={t("set_fonts_sizes_desc")}
      >
        {/* Font family */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Font Family
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([{id:"system",label:"System"},{id:"inter",label:"Inter"},{id:"nunito",label:"Nunito"},{id:"serif",label:"Serif"},{id:"mono",label:"Mono"}] as const).map(opt => {
              const active = font.familyId === opt.id;
              return (
                <button key={opt.id} onClick={() => setFont({ ...font, familyId: opt.id })} style={{
                  flex: 1, minWidth: 60, padding: "10px 12px", borderRadius: "8px", cursor: "pointer",
                  border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                  background: active ? colors.accentHover : colors.bgInput,
                  fontWeight: 600, fontSize: "12px",
                  color: active ? colors.accent : colors.text,
                  transition: "all 0.15s ease",
                }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* Body font size */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Body Size</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: colors.accent, fontFamily: "monospace" }}>{font.bodySize}px</span>
          </div>
          <input type="range" min={12} max={20} value={font.bodySize} onChange={e => setFont({ ...font, bodySize: Number(e.target.value) })} style={{ width: "100%", accentColor: colors.accent }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: colors.textMuted }}>
            <span>12px</span><span>16px</span><span>20px</span>
          </div>
        </div>
        {/* Heading font size */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Heading Size</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: colors.accent, fontFamily: "monospace" }}>{font.headingSize}px</span>
          </div>
          <input type="range" min={16} max={32} value={font.headingSize} onChange={e => setFont({ ...font, headingSize: Number(e.target.value) })} style={{ width: "100%", accentColor: colors.accent }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: colors.textMuted }}>
            <span>16px</span><span>24px</span><span>32px</span>
          </div>
        </div>
      </Section>

      {/* ══════════════ DATA EXPORT ══════════════ */}
      <Section
        colors={colors}
        icon={<Download size={20} color={colors.accent} />}
        iconBg={colors.accentHover}
        iconColor={colors.accent}
        title={t("set_export_section")}
        subtitle={t("set_export_desc")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

          {/* Export Patients */}
          <button
            onClick={exportPatients}
            disabled={!!exporting}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderRadius: "10px", cursor: exporting ? "not-allowed" : "pointer",
              border: `1px solid ${colors.border}`, background: colors.bgInput,
              opacity: exporting && exporting !== "patients" ? 0.5 : 1,
              transition: "all 0.15s ease", width: "100%", textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "8px", background: colors.accentHover, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Users size={18} color={colors.accent} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: colors.text }}>
                  {t("set_export_patients")}
                </div>
                <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: "1px" }}>
                  CSV — names, contacts, medical info
                </div>
              </div>
            </div>
            {exporting === "patients" ? (
              <span style={{ fontSize: "12px", color: colors.textMuted }}>Exporting…</span>
            ) : (
              <ChevronRight size={16} color={colors.textMuted} />
            )}
          </button>

          {/* Export Appointments */}
          <button
            onClick={exportAppointments}
            disabled={!!exporting}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderRadius: "10px", cursor: exporting ? "not-allowed" : "pointer",
              border: `1px solid ${colors.border}`, background: colors.bgInput,
              opacity: exporting && exporting !== "appointments" ? 0.5 : 1,
              transition: "all 0.15s ease", width: "100%", textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "8px", background: colors.successBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calendar size={18} color={colors.success} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: colors.text }}>
                  {t("set_export_appointments")}
                </div>
                <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: "1px" }}>
                  CSV — dates, status, duration, reason
                </div>
              </div>
            </div>
            {exporting === "appointments" ? (
              <span style={{ fontSize: "12px", color: colors.textMuted }}>Exporting…</span>
            ) : (
              <ChevronRight size={16} color={colors.textMuted} />
            )}
          </button>

          {/* Export Financials */}
          <button
            onClick={exportFinancials}
            disabled={!!exporting}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px", borderRadius: "10px", cursor: exporting ? "not-allowed" : "pointer",
              border: `1px solid ${colors.border}`, background: colors.bgInput,
              opacity: exporting && exporting !== "financials" ? 0.5 : 1,
              transition: "all 0.15s ease", width: "100%", textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "8px", background: colors.warningBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <DollarSign size={18} color={colors.warning} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: colors.text }}>
                  {t("set_export_financials")}
                </div>
                <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: "1px" }}>
                  CSV — payments, invoices, methods, discounts
                </div>
              </div>
            </div>
            {exporting === "financials" ? (
              <span style={{ fontSize: "12px", color: colors.textMuted }}>Exporting…</span>
            ) : (
              <ChevronRight size={16} color={colors.textMuted} />
            )}
          </button>

        </div>
      </Section>

      {/* ══════════════ ABOUT ══════════════ */}
      <div
        style={{
          background: colors.bgInput,
          border: `1px solid ${colors.border}`,
          borderRadius: "14px",
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "13px",
          color: colors.textSecondary,
        }}
      >
        <span>{t("set_built_with")}</span>
        <span style={{ fontWeight: 600, color: colors.textMuted, fontSize: "12px" }}>
          {t("set_version")} 1.0.0
        </span>
      </div>
    </div>
  );
};

export default Settings;