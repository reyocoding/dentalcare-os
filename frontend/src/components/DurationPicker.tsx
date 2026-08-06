import { Clock } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./Languagecontext";

const DURATION_PRESETS = [15, 30, 45, 60, 90];

interface DurationPickerProps {
  value: number;
  onChange: (minutes: number) => void;
  label?: string;
  min?: number;
  max?: number;
}

/**
 * One consistent duration picker everywhere: preset buttons + a custom
 * number field. Default selection is 30 minutes.
 */
const DurationPicker = ({
  value,
  onChange,
  label,
  min = 5,
  max = 180,
}: DurationPickerProps) => {
  const { colors } = useTheme();
  const { t } = useLanguage();

  return (
    <div>
      {label && (
        <label style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontWeight: 600, color: colors.text }}>
          <Clock size={16} /> {label}
        </label>
      )}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        {DURATION_PRESETS.map((preset) => {
          const active = value === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: active ? "none" : `1px solid ${colors.border}`,
                backgroundColor: active ? `var(--accent-color, ${colors.accent})` : colors.bgCard,
                color: active ? colors.accentText : colors.textSecondary,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {preset}{t("duration_min")}
            </button>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "auto" }}>
          <input
            type="number"
            min={min}
            max={max}
            step="5"
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(Number.isFinite(v) && v > 0 ? Math.min(v, max) : 30);
            }}
            style={{
              width: "70px",
              padding: "8px",
              borderRadius: "8px",
              border: `1px solid ${colors.border}`,
              textAlign: "center",
              background: colors.bgInput,
              color: colors.text,
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textSecondary }}>{t("duration_min")}</span>
        </div>
      </div>
    </div>
  );
};

export default DurationPicker;