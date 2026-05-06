import { initLogger } from "braintrust";

export const TANKESTROM_BRAINTRUST_PROJECT = "tankestrommen";

let braintrustLoggerReady = false;

/** Kall før traced/startSpan når BRAINTRUST_API_KEY er satt (idempotent). */
export function ensureBraintrustLoggerForProject(): void {
  if (braintrustLoggerReady) return;
  const apiKey = process.env.BRAINTRUST_API_KEY?.trim();
  if (!apiKey) return;

  const apiUrl = process.env.BRAINTRUST_API_URL?.trim();
  initLogger({
    projectName: TANKESTROM_BRAINTRUST_PROJECT,
    apiKey,
    setCurrent: true,
    ...(apiUrl ? { apiUrl } : {}),
  });
  console.info("[Braintrust tracing enabled]", { projectName: TANKESTROM_BRAINTRUST_PROJECT });
  braintrustLoggerReady = true;
}
