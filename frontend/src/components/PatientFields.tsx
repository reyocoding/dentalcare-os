import { useTheme } from "./ThemeContext";
import { useLanguage } from "./Languagecontext";
import { DateTimePicker } from "./DateTimePicker";
import { Mars, Venus } from "lucide-react";

// ─── Gender as two clickable option buttons (Male / Female) ────────────────

export const GenderToggle = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const options = [
    { value: "Male", icon: <Mars size={16} />, label: t("patients_male") },
    { value: "Female", icon: <Venus size={16} />, label: t("patients_female") },
  ];

  return (
    <div style={{ display: "flex", gap: "8px" }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              cursor: "pointer",
              border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: active ? colors.accentHover : colors.bgInput,
              color: active ? colors.accent : colors.textSecondary,
              fontWeight: 600,
              fontSize: "14px",
              transition: "all 0.15s ease",
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

// ─── Date of birth: custom picker (no future dates) + quick age presets ────

const AGE_PRESETS = [5, 10, 15, 20, 30, 40, 50, 60, 70];

export const DobField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  const setAge = (years: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    const pad = (n: number) => String(n).padStart(2, "0");
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  return (
    <div>
      <DateTimePicker
        mode="date"
        value={value}
        onChange={onChange}
        label=""
        maxDate={new Date()}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {t("form_quick_age")}
        </span>
        {AGE_PRESETS.map((years) => (
          <button
            key={years}
            type="button"
            onClick={() => setAge(years)}
            style={{
              padding: "3px 10px",
              borderRadius: "999px",
              border: `1px solid ${colors.border}`,
              background: colors.bgInput,
              color: colors.textSecondary,
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {years}
          </button>
        ))}
      </div>
    </div>
  );
};
