/**
 * CI-kontroll av TypeScript-baseline.
 *
 * Kjører den faktiske `npx tsc --noEmit`-kommandoen, teller FAKTISKE diagnostikklinjer
 * (`sti(l,k): error TSxxxx:` eller `error TSxxxx:` fra linjestart — aldri tilfeldige
 * forekomster av teksten «error TS»), og håndhever baseline:
 *
 *   - antall feil > 35            → baseline-brudd (exit 1)
 *   - antall feil ≤ 35            → pass (lavere antall består som forbedring)
 *   - konfigurasjonsfeil fra tsc  → operasjonell feil (exit 1) — et ødelagt tsconfig-oppsett
 *     som gir «null analyserte filer» skal ALDRI bestå som forbedring
 *   - inkonsistent exit/antall    → operasjonell feil (exit 1)
 *
 * Full tsc-output skrives alltid til loggen — aldri skjult.
 * Ren Node stdlib: ingen dependencies, ingen nettverk, ingen `.env`, ingen klokke/random.
 *
 * Bruk: node scripts/ci/check-tsc-baseline.mjs
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const TSC_ERROR_BASELINE = 35;

/**
 * En faktisk diagnostikklinje: valgfritt `sti(linje,kolonne): `-prefiks etterfulgt av
 * `error TSxxxx: ` — forankret i linjestart.
 */
const DIAGNOSTIC_LINE_RE = /^(?:.+\(\d+,\d+\): )?error TS(\d+): /;

/** TS-koder som betyr ødelagt oppsett (config/inputs), ikke vanlige typefeil. */
export function isTscConfigErrorCode(code) {
  return (code >= 5000 && code <= 5999) || code === 18003 || code === 6053 || code === 6231;
}

/** Teller faktiske diagnostikklinjer og returnerer TS-kodene deres i rekkefølge. */
export function collectTscDiagnosticCodes(output) {
  if (typeof output !== "string") return [];
  const codes = [];
  for (const line of output.split(/\r?\n/)) {
    const match = DIAGNOSTIC_LINE_RE.exec(line);
    if (match) codes.push(Number.parseInt(match[1], 10));
  }
  return codes;
}

/**
 * Ren evaluering av en tsc-kjøring. `exitCode: null` betyr at kommandoen ikke kunne kjøres.
 * Returnerer { status: "pass" | "baseline_exceeded" | "operational_fail", errorCount, problems }.
 */
export function evaluateTscBaseline({ exitCode, output, baseline = TSC_ERROR_BASELINE }) {
  if (exitCode === null || exitCode === undefined) {
    return { status: "operational_fail", errorCount: 0, problems: ["tsc-kommandoen kunne ikke kjøres."] };
  }
  const codes = collectTscDiagnosticCodes(output);
  const configErrors = codes.filter(isTscConfigErrorCode);
  if (configErrors.length > 0) {
    return {
      status: "operational_fail",
      errorCount: codes.length,
      problems: [
        `tsc rapporterte konfigurasjonsfeil (TS${configErrors[0]}) — oppsettet er ødelagt og resultatet kan ikke sammenlignes med baseline.`,
      ],
    };
  }
  if (exitCode === 0 && codes.length > 0) {
    return {
      status: "operational_fail",
      errorCount: codes.length,
      problems: [`Inkonsistent tsc-kjøring: exit 0, men ${codes.length} diagnostikklinjer.`],
    };
  }
  if (exitCode !== 0 && codes.length === 0) {
    return {
      status: "operational_fail",
      errorCount: 0,
      problems: [`tsc feilet (exit ${exitCode}) uten TypeScript-diagnostikk — kommandoen kjørte ikke korrekt.`],
    };
  }
  if (codes.length > baseline) {
    return {
      status: "baseline_exceeded",
      errorCount: codes.length,
      problems: [`${codes.length} TypeScript-feil er over baseline på ${baseline} — nye feil er introdusert.`],
    };
  }
  return { status: "pass", errorCount: codes.length, problems: [] };
}

function main() {
  const result = spawnSync("npx tsc --noEmit --pretty false", {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // Full tsc-output i loggen — aldri skjult.
  if (output.trim() !== "") process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  const exitCode = result.error ? null : result.status;
  const verdict = evaluateTscBaseline({ exitCode, output });
  console.log(`TypeScript-feil: ${verdict.errorCount} (baseline: ${TSC_ERROR_BASELINE})`);
  if (verdict.status === "pass") {
    if (verdict.errorCount < TSC_ERROR_BASELINE) {
      console.log(`Under baseline — forbedring består. Vurder å senke baseline til ${verdict.errorCount}.`);
    }
    return 0;
  }
  for (const problem of verdict.problems) console.error(problem);
  console.error(`::error title=TypeScript baseline::${verdict.problems[0]}`);
  return 1;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  process.exit(main());
}
