import type { AIAnalysisResult, DayScheduleEntry, TimeSlot } from "@/lib/types";

const CATEGORY_LABELS: Record<AIAnalysisResult["category"], string> = {
  arrangement: "Arrangement",
  frist: "Frist",
  beskjed: "Beskjed",
  trening: "Trening",
  møte: "Møte",
  annet: "Annet",
};

function formatSlot(slot: TimeSlot): string {
  const parts: string[] = [];
  if (slot.label) parts.push(slot.label + ":");
  if (slot.date) parts.push(slot.date);
  if (slot.time) parts.push("kl. " + slot.time);
  return parts.join(" ") || "Ikke oppgitt";
}

function formatDayEntry(d: DayScheduleEntry): string {
  const head = [d.dayLabel, d.date].filter(Boolean).join(" · ");
  const time = d.time ? "kl. " + d.time : "";
  return [head, time].filter(Boolean).join(" ") || "—";
}

function renderItemList(items: string[]) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-sm text-gray-700">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
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

interface AnalysisResultProps {
  result: AIAnalysisResult;
}

export default function AnalysisResult({ result }: AnalysisResultProps) {
  const usePerDay = result.scheduleByDay.length > 0;
  const sourceFileUrl = result.sourceHint?.fileUrl ?? null;

  const fields: { label: string; value: string | null; isLink?: boolean }[] = [
    { label: "Tittel", value: result.title },
    { label: "Sted", value: result.location },
    { label: "Type", value: CATEGORY_LABELS[result.category] },
    { label: "Gjelder", value: result.targetGroup },
    { label: "Arrangør", value: result.organizer },
    { label: "Kontaktperson", value: result.contactPerson },
    { label: "Lenke", value: result.sourceUrl, isLink: true },
    { label: "Detaljer", value: result.description },
  ];

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Analyse
        </h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {Math.round(result.confidence * 100)}% sikkerhet
        </span>
      </div>

      {result.sourceHint?.type === "pdf" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4 flex-shrink-0 text-amber-700"
          >
            <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-.59-1.41l-4-4A2 2 0 0 0 14 2H6Zm8 2.41L17.59 8H14a2 2 0 0 1-2-2V4.41ZM8 12h8a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2Zm0 4h6a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2Z" />
          </svg>
          <span>
            <span className="font-medium">PDF:</span>{" "}
            {result.sourceHint.fileName} · {result.sourceHint.pageCount}{" "}
            {result.sourceHint.pageCount === 1 ? "side" : "sider"}
          </span>
          {sourceFileUrl && (
            <div className="ml-auto flex items-center gap-2">
              <a
                href={sourceFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Åpne originalfil
              </a>
              <a
                href={sourceFileUrl}
                download={result.sourceHint.fileName}
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Last ned
              </a>
            </div>
          )}
        </div>
      )}

      {result.sourceHint?.type === "docx" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-4 w-4 flex-shrink-0 text-blue-700"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
          <span>
            <span className="font-medium">Word (.docx):</span>{" "}
            {result.sourceHint.fileName}
          </span>
          {sourceFileUrl && (
            <div className="ml-auto flex items-center gap-2">
              <a
                href={sourceFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100"
              >
                Åpne originalfil
              </a>
              <a
                href={sourceFileUrl}
                download={result.sourceHint.fileName}
                className="rounded-md border border-blue-300 bg-white px-2 py-1 text-[11px] font-medium text-blue-900 hover:bg-blue-100"
              >
                Last ned
              </a>
            </div>
          )}
        </div>
      )}

      {result.sourceHint?.type === "image" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
          <span>
            <span className="font-medium">Bilde:</span> {result.sourceHint.fileName}
          </span>
          {sourceFileUrl && (
            <div className="ml-auto flex items-center gap-2">
              <a
                href={sourceFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-100"
              >
                Åpne originalfil
              </a>
              <a
                href={sourceFileUrl}
                download={result.sourceHint.fileName}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-100"
              >
                Last ned
              </a>
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 space-y-3">
        {usePerDay && (
          <div>
            <dt className="text-xs font-medium text-gray-400">
              Per dag (ukeplan / flere dager)
            </dt>
            <dd className="text-gray-900">
              <ul className="mt-1 space-y-3">
                {result.scheduleByDay.map((d, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-sm"
                  >
                    <p className="font-medium text-gray-900">
                      {formatDayEntry(d)}
                    </p>
                    {hasStructuredDayContent(d) ? (
                      <div className="mt-2 space-y-2">
                        {d.highlights.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Høydepunkter
                            </p>
                            {renderItemList(d.highlights)}
                          </div>
                        )}
                        {d.rememberItems.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Husk
                            </p>
                            {renderItemList(d.rememberItems)}
                          </div>
                        )}
                        {d.deadlines.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Frister
                            </p>
                            {renderItemList(d.deadlines)}
                          </div>
                        )}
                        {d.notes.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Notater
                            </p>
                            {renderItemList(d.notes)}
                          </div>
                        )}
                      </div>
                    ) : (
                      d.details && (
                        <p className="mt-1.5 whitespace-pre-wrap text-gray-700">
                          {d.details}
                        </p>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {!usePerDay && result.schedule.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-gray-400">
              {result.schedule.length === 1 ? "Tidspunkt" : "Tidspunkter"}
            </dt>
            <dd className="text-gray-900">
              {result.schedule.length === 1 ? (
                formatSlot(result.schedule[0])
              ) : (
                <ul className="mt-1 space-y-1">
                  {result.schedule.map((slot, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                      {formatSlot(slot)}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        )}

        {fields.map(
          (field) =>
            field.value && (
              <div key={field.label}>
                <dt className="text-xs font-medium text-gray-400">
                  {field.label}
                </dt>
                <dd className="text-gray-900">
                  {field.isLink ? (
                    <a
                      href={field.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline decoration-blue-300 transition-colors hover:text-blue-800"
                    >
                      {field.value}
                    </a>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            )
        )}
      </dl>

      {result.extractedText?.raw && (
        <div className="mt-5 border-t border-gray-100 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-gray-400">
              {result.sourceHint?.type === "pdf"
                ? "Tekst uttrekk fra PDF"
                : result.sourceHint?.type === "docx"
                  ? "Tekst uttrekk fra Word"
                  : "Original tekst fra bildet"}
            </h3>
            <div className="flex items-center gap-2">
              {result.extractedText.language && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-500">
                  {result.extractedText.language}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                {result.sourceHint?.type === "pdf" ||
                result.sourceHint?.type === "docx"
                  ? `Ekstrahert ${Math.round(result.extractedText.confidence * 100)}%`
                  : `OCR ${Math.round(result.extractedText.confidence * 100)}%`}
              </span>
            </div>
          </div>
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
            {result.extractedText.raw}
          </pre>
        </div>
      )}
    </div>
  );
}
