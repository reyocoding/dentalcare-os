import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import moment from "moment";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./Languagecontext";

export type PickerMode = "date" | "time" | "datetime";

interface DateTimePickerProps {
  value: string; // "YYYY-MM-DD" | "HH:mm" | "YYYY-MM-DDTHH:mm"
  onChange: (value: string) => void;
  mode?: PickerMode;
  label?: string;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  required?: boolean;
  disabled?: boolean;
  onDateChange?: (date: string) => void;
}

// Weekday initials follow the active language (moment ships locale data for
// en/fr/ar) instead of being hardcoded English.
const getWeekdays = (locale: string): string[] => {
  try {
    const data = moment.localeData(locale);
    return data.weekdaysShort().map((d: string) => d.slice(0, 2));
  } catch {
    return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  }
};

const MINUTE_STEP = 5;

const to12Hour = (h24: number) => {
  const ampm: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, ampm };
};

const to24Hour = (h12: number, ampm: "AM" | "PM") => {
  let h = h12 % 12;
  if (ampm === "PM") h += 12;
  return h;
};

export const DateTimePicker = ({
  value,
  onChange,
  mode = "datetime",
  label,
  placeholder,
  minDate,
  maxDate,
  required,
  disabled,
  onDateChange,
}: DateTimePickerProps) => {
  const { colors } = useTheme();
  const { t, language } = useLanguage();
  const weekdays = getWeekdays(language);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    value && mode !== "time" ? moment(value) : moment()
  );
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value && mode !== "time") setViewMonth(moment(value));
  }, [value, mode]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleScroll = () => setOpen(false);

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  const openPopover = () => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const width = mode === "time" ? 220 : 300;
      let left = rect.left;
      if (left + width > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - width - 12);
      }
      let top = rect.bottom + 6;
      const estimatedHeight = mode === "time" ? 180 : mode === "date" ? 340 : 400;
      if (top + estimatedHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - estimatedHeight - 6);
      }
      setPopoverStyle({ position: "fixed", top, left, width, zIndex: 2000 });
    }
    setOpen(true);
  };

  // ---- value parsing / formatting ----
  const dateMoment = value && mode !== "time" ? moment(value) : null;
  const timeMoment =
    mode === "time" ? (value ? moment(value, "HH:mm") : null)
    : mode === "datetime" ? (value ? moment(value) : null)
    : null;

  const displayText = () => {
    if (!value) return placeholder || (
      mode === "date" ? t("picker_select_date") : mode === "time" ? t("picker_select_time") : t("picker_select_datetime")
    );
    if (mode === "date") return moment(value).format("ddd, MMM D, YYYY");
    if (mode === "time") return moment(value, "HH:mm").format("h:mm A");
    return moment(value).format("ddd, MMM D, YYYY · h:mm A");
  };

  // ---- commit helpers ----
  const commitDay = (day: moment.Moment) => {
    onDateChange?.(day.format("YYYY-MM-DD"));
    if (mode === "date") {
      onChange(day.format("YYYY-MM-DD"));
      setOpen(false);
    } else if (mode === "datetime") {
      const current = value ? moment(value) : moment().hour(9).minute(0);
      const combined = day.clone().hour(current.hour()).minute(current.minute()).second(0);
      onChange(combined.format("YYYY-MM-DDTHH:mm"));
    }
  };

  const commitTime = (h24: number, minute: number) => {
    if (mode === "time") {
      onChange(moment().hour(h24).minute(minute).format("HH:mm"));
    } else if (mode === "datetime") {
      const current = value ? moment(value) : moment();
      const combined = current.clone().hour(h24).minute(minute).second(0);
      onChange(combined.format("YYYY-MM-DDTHH:mm"));
    }
  };

  const goToday = () => {
    const today = moment();
    setViewMonth(today);
    commitDay(today);
  };

  // ---- render helpers ----
  const renderCalendarGrid = () => {
    const startOfMonth = viewMonth.clone().startOf("month");
    const gridStart = startOfMonth.clone().startOf("week");
    const days: moment.Moment[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(gridStart.clone().add(i, "days"));
    }

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <button
            type="button"
            onClick={() => setViewMonth((m) => m.clone().subtract(1, "month"))}
            style={navBtnStyle}
          >
            <ChevronLeft size={16} />
          </button>
          <strong style={{ fontSize: "13px", color: colors.text }}>
            {viewMonth.format("MMMM YYYY")}
          </strong>
          <button
            type="button"
            onClick={() => setViewMonth((m) => m.clone().add(1, "month"))}
            style={navBtnStyle}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px", marginBottom: "4px" }}>
          {weekdays.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: "11px", fontWeight: 600, color: colors.textMuted, padding: "4px 0" }}>
              {d}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
          {days.map((day, i) => {
            const inMonth = day.month() === viewMonth.month();
            const isToday = day.isSame(moment(), "day");
            const isSelected = dateMoment && day.isSame(dateMoment, "day");
            const isDisabled =
              (minDate && day.isBefore(moment(minDate), "day")) ||
              (maxDate && day.isAfter(moment(maxDate), "day"));

            return (
              <button
                key={i}
                type="button"
                disabled={!!isDisabled}
                onClick={() => commitDay(day)}
                style={{
                  padding: "7px 0",
                  borderRadius: "6px",
                  border: isToday && !isSelected ? `1px solid ${colors.accent}` : "1px solid transparent",
                  background: isSelected ? colors.accent : "transparent",
                  color: isDisabled
                    ? colors.border
                    : isSelected
                    ? colors.accentText
                    : inMonth
                    ? colors.text
                    : colors.textMuted,
                  fontSize: "12.5px",
                  fontWeight: isSelected || isToday ? 700 : 500,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
              >
                {day.date()}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={goToday}
          style={{ ...navBtnStyle, width: "100%", marginTop: "10px", fontSize: "12px", fontWeight: 600, color: colors.accent }}
        >
          {t("today")}
        </button>
      </div>
    );
  };

  const renderTimeSelects = () => {
    const current = timeMoment || moment().hour(9).minute(0);
    const { h12, ampm } = to12Hour(current.hour());
    // Clamp to the last option: Math.round(58/5)*5 = 60 has no matching
    // option and would roll the time into the next hour on commit.
    const minute = Math.min(
      Math.round(current.minute() / MINUTE_STEP) * MINUTE_STEP,
      60 - MINUTE_STEP
    );

    const hourOptions = Array.from({ length: 12 }, (_, i) => i + 1);
    const minuteOptions = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

    return (
      <div style={{ display: "flex", gap: "6px", marginTop: mode === "datetime" ? "12px" : 0 }}>
        <select
          value={h12}
          onChange={(e) => commitTime(to24Hour(Number(e.target.value), ampm), minute)}
          style={timeSelectStyle}
        >
          {hourOptions.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <select
          value={minute}
          onChange={(e) => commitTime(to24Hour(h12, ampm), Number(e.target.value))}
          style={timeSelectStyle}
        >
          {minuteOptions.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
          ))}
        </select>
        <select
          value={ampm}
          onChange={(e) => commitTime(to24Hour(h12, e.target.value as "AM" | "PM"), minute)}
          style={timeSelectStyle}
        >
          <option value="AM">{t("picker_am")}</option>
          <option value="PM">{t("picker_pm")}</option>
        </select>
      </div>
    );
  };

  return (
    <div>
      {label && (
        <label style={{ display: "block", marginBottom: "6px", fontWeight: 600, fontSize: "13px", color: colors.textSecondary }}>
          {label}{required ? " *" : ""}
        </label>
      )}

      <div
        ref={triggerRef}
        onClick={openPopover}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: open ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
          background: disabled ? colors.bgInput : colors.bgCard,
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: "14px",
          color: value ? colors.text : colors.textMuted,
          boxShadow: open ? `0 0 0 3px ${colors.accent}1f` : "none",
          transition: "all 0.12s ease",
        }}
      >
        {mode === "time" ? <Clock size={16} color={colors.textSecondary} /> : <CalendarIcon size={16} color={colors.textSecondary} />}
        <span style={{ flex: 1 }}>{displayText()}</span>
        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: colors.textMuted, display: "flex" }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={popoverRef}
          style={{
            ...popoverStyle,
            background: colors.bgCard,
            borderRadius: "12px",
            padding: "14px",
            boxShadow: colors.cardShadow,
            border: `1px solid ${colors.border}`,
          }}
        >
          {mode !== "time" && renderCalendarGrid()}
          {(mode === "time" || mode === "datetime") && renderTimeSelects()}
          {mode === "datetime" && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: "100%",
                marginTop: "12px",
                padding: "8px",
                borderRadius: "8px",
                border: "none",
                background: colors.accent,
                color: colors.accentText,
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              {t("picker_done")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const navBtnStyle: Record<string, string> = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 8px",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  cursor: "pointer",
  color: "var(--text-secondary)",
};

const timeSelectStyle: Record<string, string> = {
  flex: "1",
  padding: "8px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  fontSize: "13px",
  textAlign: "center",
  background: "var(--bg-card)",
  color: "var(--text)",
};

export default DateTimePicker;