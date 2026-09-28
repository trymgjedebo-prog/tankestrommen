/**
 * `debugMessage` i /api/analyze-feilsvar. I produksjon returneres ALDRI serverens stack trace eller
 * rå exception-tekst til klienten — kun en stabil, generisk tekst (full feil logges fortsatt på
 * serveren via eksisterende console.error). Utenfor produksjon (development/test) bevares dagens
 * interne diagnostikk: stack, ellers melding.
 *
 * Endrer ikke feltets form: `debugMessage` er fortsatt alltid en streng, og `errorCode`/`message`/
 * HTTP-status settes som før av kallstedet.
 */
export const PRODUCTION_CLIENT_DEBUG_MESSAGE = "Intern feil. Detaljer er logget på serveren.";

export function clientDebugMessageForError(
  err: unknown,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  if (nodeEnv === "production") return PRODUCTION_CLIENT_DEBUG_MESSAGE;
  return err instanceof Error ? err.stack || err.message : String(err);
}
