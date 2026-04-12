import type { ConfirmedEvent, EventCategory, DayScheduleEntry } from "@/lib/types";

const CATEGORY_LABELS: Record<EventCategory, string> = {
  arrangement: "Arrangement",
  frist: "Frist",
  beskjed: "Beskjed",
  trening: "Trening",
  møte: "Møte",
  annet: "Annet",
};

function formatDayLine(d: DayScheduleEntry): string {
  const head = [d.dayLabel, d.date].filter(Boolean).join(" ");
  const t = d.time ? "kl. " + d.time : "";
  return [head, t].filter(Boolean).join(" ") || "—";
}

function renderItemList(items: string[]) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs text-gray-700">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 leading-snug">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function hasStructuredDayContent(d: DayScheduleEntry): boolean {
  return (
    d.highlights.length > 0 ||
    d.rememberItems.length > 0 ||
    d.deadlines.length > 0 ||
    d.notes.length > 0
  );
}

function formatScheduleSummary(event: ConfirmedEvent): string | null {
  const byDay = event.scheduleByDay ?? [];
  if (byDay.length > 0) {
    return byDay.map(formatDayLine).join("  ·  ");
  }
  const slots = event.schedule.filter((s) => s.date || s.time);
  if (slots.length === 0) return null;
  return slots
    .map((s) =>
      [s.date, s.time ? "kl. " + s.time : null].filter(Boolean).join(" ")
    )
    .join("  ·  ");
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ConfirmedHistoryProps {
  history: ConfirmedEvent[];
  onClear?: () => void;
}

export default function ConfirmedHistory({
  history,
  onClear,
}: ConfirmedHistoryProps) {
  if (history.length === 0) return null;

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Bekreftede analyser ({history.length})
        </h2>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            Tøm historikk
          </button>
        )}
      </div>

      <div className="space-y-3">
        {history.map((event, i) => {
          const scheduleSummary = formatScheduleSummary(event);
          const byDay = event.scheduleByDay ?? [];
          return (
            <div
              key={event.confirmedAt + i}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-medium text-gray-900">
                  {event.title}
                </h3>
                <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                  {CATEGORY_LABELS[event.category]}
                </span>
              </div>

              <dl className="mt-2 space-y-1 text-sm text-gray-600">
                {byDay.length > 0 ? (
                  <div className="flex items-start gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <ul className="min-w-0 flex-1 space-y-2 text-xs">
                      {byDay.map((d, j) => (
                        <li
                          key={j}
                          className="rounded-md border border-gray-100 bg-gray-50/70 p-2"
                        >
                          <p className="font-medium text-gray-900">{formatDayLine(d)}</p>
                          {hasStructuredDayContent(d) ? (
                            <div className="mt-1.5 space-y-1.5">
                              {d.highlights.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Høydepunkter
                                  </p>
                                  {renderItemList(d.highlights)}
                                </div>
                              )}
                              {d.rememberItems.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Husk
                                  </p>
                                  {renderItemList(d.rememberItems)}
                                </div>
                              )}
                              {d.deadlines.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Frister
                                  </p>
                                  {renderItemList(d.deadlines)}
                                </div>
                              )}
                              {d.notes.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                    Notater
                                  </p>
                                  {renderItemList(d.notes)}
                                </div>
                              )}
                            </div>
                          ) : (
                            d.details && (
                              <p className="mt-1 text-gray-700">{d.details}</p>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  scheduleSummary && (
                    <div className="flex items-start gap-1.5">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>{scheduleSummary}</span>
                    </div>
                  )
                )}

                {event.location && (
                  <div className="flex items-start gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    >
                      <path
                        fillRule="evenodd"
                        d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{event.location}</span>
                  </div>
                )}

                {event.targetGroup && (
                  <div className="flex items-start gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    >
                      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
                    </svg>
                    <span>{event.targetGroup}</span>
                  </div>
                )}

                {event.organizer && (
                  <div className="flex items-start gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4 16.5v-13h-.25a.75.75 0 0 1 0-1.5h12.5a.75.75 0 0 1 0 1.5H16v13h.25a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1 0-1.5H4Zm3-11a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7 5.5Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 7 8.5ZM8.75 13a1.25 1.25 0 1 0 2.5 0v-3.5h-2.5V13Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{event.organizer}</span>
                  </div>
                )}

                {event.sourceUrl && (
                  <div className="flex items-start gap-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    >
                      <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                      <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                    </svg>
                    <a
                      href={event.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-blue-600 underline decoration-blue-300 hover:text-blue-800"
                    >
                      {event.sourceUrl}
                    </a>
                  </div>
                )}
              </dl>

              <p className="mt-2 text-[10px] text-gray-400">
                Bekreftet {formatTimestamp(event.confirmedAt)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
