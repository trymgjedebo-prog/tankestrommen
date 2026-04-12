"use client";

import { useState } from "react";
import type {
  ProposedEvent,
  EventCategory,
  TimeSlot,
  DayScheduleEntry,
} from "@/lib/types";

function emptyDayEntry(): DayScheduleEntry {
  return {
    dayLabel: null,
    date: null,
    time: null,
    details: null,
    highlights: [],
    rememberItems: [],
    deadlines: [],
    notes: [],
  };
}

const CATEGORY_OPTIONS: { value: EventCategory; label: string }[] = [
  { value: "arrangement", label: "Arrangement" },
  { value: "frist", label: "Frist" },
  { value: "beskjed", label: "Beskjed" },
  { value: "trening", label: "Trening" },
  { value: "møte", label: "Møte" },
  { value: "annet", label: "Annet" },
];

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 transition-colors focus:border-gray-500 focus:outline-none";

interface EditableResultProps {
  initial: ProposedEvent;
  onConfirm?: (event: ProposedEvent) => void;
  onDiscard?: () => void;
}

export default function EditableResult({
  initial,
  onConfirm,
  onDiscard,
}: EditableResultProps) {
  const [event, setEvent] = useState<ProposedEvent>(initial);

  function update<K extends keyof ProposedEvent>(
    key: K,
    value: ProposedEvent[K]
  ) {
    setEvent((prev) => ({ ...prev, [key]: value }));
  }

  function updateSlot(index: number, field: keyof TimeSlot, value: string) {
    setEvent((prev) => {
      const next = [...prev.schedule];
      next[index] = { ...next[index], [field]: value || null };
      return { ...prev, schedule: next };
    });
  }

  function addSlot() {
    setEvent((prev) => ({
      ...prev,
      schedule: [...prev.schedule, { date: null, time: null, label: null }],
    }));
  }

  function removeSlot(index: number) {
    setEvent((prev) => ({
      ...prev,
      schedule: prev.schedule.filter((_, i) => i !== index),
    }));
  }

  function updateDayRow(
    index: number,
    field: keyof DayScheduleEntry,
    value: string
  ) {
    setEvent((prev) => {
      const next = [...prev.scheduleByDay];
      next[index] = { ...next[index], [field]: value.trim() ? value : null };
      return { ...prev, scheduleByDay: next };
    });
  }

  function addDayRow() {
    setEvent((prev) => ({
      ...prev,
      scheduleByDay: [...prev.scheduleByDay, emptyDayEntry()],
    }));
  }

  function removeDayRow(index: number) {
    setEvent((prev) => ({
      ...prev,
      scheduleByDay: prev.scheduleByDay.filter((_, i) => i !== index),
    }));
  }

  const usePerDay = event.scheduleByDay.length > 0;

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Rediger resultat
      </h2>

      <div className="mt-4 space-y-4">
        <Field label="Tittel">
          <input
            type="text"
            value={event.title}
            onChange={(e) => update("title", e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        {usePerDay ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-400">
                Per dag (ukeplan / flere dager)
              </label>
              <button
                type="button"
                onClick={addDayRow}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                + Legg til dag
              </button>
            </div>
            <div className="space-y-3">
              {event.scheduleByDay.map((row, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">
                      Dag {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDayRow(i)}
                      className="rounded px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      Fjern
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Dag (f.eks. mandag)"
                      value={row.dayLabel ?? ""}
                      onChange={(e) =>
                        updateDayRow(i, "dayLabel", e.target.value)
                      }
                      className={INPUT_CLASS}
                    />
                    <input
                      type="text"
                      placeholder="Dato"
                      value={row.date ?? ""}
                      onChange={(e) => updateDayRow(i, "date", e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Tidspunkt"
                    value={row.time ?? ""}
                    onChange={(e) => updateDayRow(i, "time", e.target.value)}
                    className={`${INPUT_CLASS} mt-3`}
                  />
                  <textarea
                    placeholder="Hva skjer denne dagen?"
                    value={row.details ?? ""}
                    onChange={(e) =>
                      updateDayRow(i, "details", e.target.value)
                    }
                    rows={2}
                    className={`${INPUT_CLASS} mt-3`}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-400">
                {event.schedule.length <= 1 ? "Tidspunkt" : "Tidspunkter"}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEvent((p) => ({
                      ...p,
                      scheduleByDay: [emptyDayEntry()],
                    }))
                  }
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  Per dag
                </button>
                <button
                  type="button"
                  onClick={addSlot}
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  + Legg til
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {event.schedule.map((slot, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                >
                  {event.schedule.length > 1 && (
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-400">
                        Del {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSlot(i)}
                        className="rounded px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        Fjern
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Dato"
                      value={slot.date ?? ""}
                      onChange={(e) => updateSlot(i, "date", e.target.value)}
                      className={INPUT_CLASS}
                    />
                    <input
                      type="text"
                      placeholder="Tidspunkt"
                      value={slot.time ?? ""}
                      onChange={(e) => updateSlot(i, "time", e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Field label="Sted">
          <input
            type="text"
            value={event.location}
            onChange={(e) => update("location", e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Type">
          <select
            value={event.category}
            onChange={(e) =>
              update("category", e.target.value as EventCategory)
            }
            className={INPUT_CLASS}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Gjelder">
          <input
            type="text"
            value={event.targetGroup}
            onChange={(e) => update("targetGroup", e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Arrangør">
          <input
            type="text"
            value={event.organizer}
            onChange={(e) => update("organizer", e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Kontaktperson">
          <input
            type="text"
            value={event.contactPerson}
            onChange={(e) => update("contactPerson", e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Lenke">
          <input
            type="url"
            value={event.sourceUrl}
            onChange={(e) => update("sourceUrl", e.target.value)}
            placeholder="https://..."
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Detaljer">
          <textarea
            value={event.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onDiscard?.()}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Forkast
        </button>
        <button
          type="button"
          onClick={() => onConfirm?.(event)}
          className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          Bekreft
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}
