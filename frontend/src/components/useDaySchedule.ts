import { useEffect, useMemo, useState } from "react";
import moment from "moment";
import { api } from "../services/api";
import type { Appointment, Patient } from "../services/api";

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 20;
const SLOT_STEP_MIN = 30;

export interface DaySchedule {
  appointments: Appointment[];
  patients: Patient[];
  patientsMap: Map<number, Patient>;
  freeSlots: string[];
  firstSlot: string;
  loading: boolean;
}

/**
 * Fetch the day's appointments + patients once per date and compute the
 * free slot starts for that date at the given duration.
 * Shared by every widget that schedules an appointment.
 */
export const useDaySchedule = (
  date: string,
  durationMinutes: number,
  excludeAppointmentId?: number
): DaySchedule => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    const start = moment(`${date}T00:00:00`).toDate();
    const end = moment(`${date}T23:59:59`).toDate();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    setLoading(true);
    Promise.all([
      api.getAppointmentsForRange(start, end),
      api.getPatients(0, 10000),
    ])
      .then(([dayAppts, dayPatients]) => {
        if (cancelled) return;
        setAppointments(dayAppts);
        setPatients(dayPatients);
      })
      .catch(() => {
        if (!cancelled) return;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const patientsMap = useMemo(() => {
    const map = new Map<number, Patient>();
    for (const p of patients) map.set(p.id, p);
    return map;
  }, [patients]);

  const freeSlots = useMemo(() => {
    if (!date) return [];
    const blocked = appointments.filter(
      (a) =>
        a.id !== excludeAppointmentId &&
        a.status !== "Canceled" &&
        a.status !== "No-Show"
    );
    const slotStart = moment(`${date}T${String(DAY_START_HOUR).padStart(2, "0")}:00:00`);
    const dayEnd = moment(`${date}T${String(DAY_END_HOUR).padStart(2, "0")}:00:00`);
    const slots: string[] = [];
    let cursor = moment(slotStart);
    while (cursor.isBefore(dayEnd) || cursor.isSame(dayEnd, "minute")) {
      const slotEnd = cursor.clone().add(durationMinutes, "minutes");
      if (slotEnd.isAfter(dayEnd)) break;
      const busy = blocked.some((a) => {
        const aStart = moment(a.appointment_datetime);
        const aEnd = aStart.clone().add(a.duration_minutes || 0, "minutes");
        return cursor.isBefore(aEnd) && slotEnd.isAfter(aStart);
      });
      if (!busy) slots.push(cursor.format("HH:mm"));
      cursor = cursor.add(SLOT_STEP_MIN, "minutes");
    }
    return slots;
  }, [date, durationMinutes, appointments, excludeAppointmentId]);

  const firstSlot = freeSlots.length > 0 ? freeSlots[0] : "";

  return { appointments, patients, patientsMap, freeSlots, firstSlot, loading };
};