import { useEffect, useRef, useState } from "react";
import moment from "moment";
import { CalendarClock, Loader2, Users, Clock, Zap } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./Languagecontext";
import { useDaySchedule } from "./useDaySchedule";

interface DayOverviewPanelProps {
  date: string;
  durationMinutes: number;
  onPickTime?: (time: string) => void;
  onFirstSlot?: (slot: string) => void;
  excludeAppointmentId?: number;
}

/**
 * Panel shown next to every appointment date picker: lists the patients
 * and sessions already booked for that day (so staff can tell a busy day
 * at a glance) plus a dropdown of free slots for that date horizontally
 * next to it on wide screens.
 */
export default function DayOverviewPanel({
  date,
  durationMinutes,
  onPickTime,
  onFirstSlot,
  excludeAppointmentId,
}: DayOverviewPanelProps) {
  const { colors } = useTheme();
  const { t } = useLanguage();
  const { appointments, patientsMap, freeSlots, firstSlot, loading } = useDaySchedule(
    date,
    durationMinutes,
    excludeAppointmentId
  );

  const [chosen, setChosen] = useState("");

  // Keep the dropdown in sync with the value the parent pushes in
  // (auto-fill first slot, or a slot the user picked elsewhere).
  const lastAuto = useRef("");
  useEffect(() => {
    if (!date || !firstSlot) return;
    const key = `${date}:${durationMinutes}`;
    if (lastAuto.current === key) return;
    lastAuto.current = key;
    onFirstSlot?.(firstSlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, firstSlot]);

  useEffect(() => {
    setChosen("");
  }, [date, durationMinutes]);

  if (!date) return null;

  const booked = appointments
    .filter((a) => a.status !== "Canceled" && a.status !== "No-Show")
    .sort((a, b) => (a.appointment_datetime < b.appointment_datetime ? -1 : 1));

  const pick = (time: string) => {
    lastAuto.current = "";
    setChosen(time);
    onPickTime?.(time);
  };

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: "14px",
        background: colors.bgCard,
        overflow: "hidden",
        marginTop: "14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          padding: "12px 16px",
          borderBottom: `1px solid ${colors.border}`,
          background: `${colors.accent}0d`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "14px", color: colors.text }}>
          <CalendarClock size={15} color={colors.accent} />
          {moment(date).format("ddd, MMM D, YYYY")}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "12px", color: colors.textSecondary }}>
          <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Users size={13} /> {booked.length} {t("slot_booked")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Clock size={13} /> {freeSlots.length} {t("slot_free")}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          display: "grid",
          gap: "20px",
          gridTemplateColumns: "minmax(240px, 340px) 1fr",
          alignItems: "start",
          background: colors.bgInput,
        }}
      >
        {/* Free-slot dropdown */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, marginBottom: "8px", display: "flex", alignItems: "center", gap: "5px" }}>
            <Zap size={12} color={colors.accent} /> {t("slot_free_times")}
          </div>
          {loading ? (
            <Loader2 size={18} className="spin" style={{ color: colors.textMuted }} />
          ) : freeSlots.length === 0 ? (
            <div style={{ fontSize: "12.5px", color: colors.textMuted, background: colors.bgCard, border: `1px solid ${colors.border}`, borderRadius: "8px", padding: "10px 12px" }}>
              {t("slot_full_day")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <select
                value={chosen}
                onChange={(e) => pick(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: `1px solid ${colors.border}`,
                  background: colors.bgCard,
                  color: colors.text,
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                <option value="" disabled>
                  {firstSlot ? `${t("slot_pick_a_time")} (${firstSlot})` : t("slot_free_times")}
                </option>
                {freeSlots.map((time) => (
                  <option key={time} value={time} selected={time === chosen}>{time}</option>
                ))}
              </select>
              {firstSlot && (
                <button
                  type="button"
                  onClick={() => pick(firstSlot)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: colors.accent,
                    color: colors.accentText,
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("slot_next_free")} · {firstSlot}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Booked patients that day */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: colors.textMuted, marginBottom: "8px", display: "flex", alignItems: "center", gap: "5px" }}>
            <Users size={12} /> {t("slot_day_booked")}
          </div>
          {booked.length === 0 ? (
            <div style={{ fontSize: "12.5px", color: colors.textMuted, background: colors.bgCard, border: `1px dashed ${colors.border}`, borderRadius: "8px", padding: "18px 12px", textAlign: "center" }}>
              {t("slot_none_booked")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: "210px", overflowY: "auto" }}>
              {booked.map((a) => {
                const p = a.patient_id ? patientsMap.get(a.patient_id) : undefined;
                const label = p ? `${p.first_name} ${p.last_name}` : t("unknown");
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      fontSize: "12.5px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: colors.bgCard,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <span style={{ color: colors.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {moment(a.appointment_datetime).format("HH:mm")} · {label}
                    </span>
                    <span style={{ color: colors.textSecondary, flexShrink: 0, fontSize: "11.5px" }}>
                      {a.duration_minutes} {t("duration_min")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}