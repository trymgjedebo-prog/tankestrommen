import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DeployFingerprint {
  /** Fast app-navn. */
  app: "tankestrommen";
  /** Fra package.json (leses ved runtime). */
  packageVersion: string;
  /** Valgfri manuell merkelapp – sett `TANKESTROM_APP_VERSION` i Vercel hvis du vil (f.eks. `2026-04-20-timeplan`). */
  appVersionLabel: string | null;
  /** Vercel: production | preview | development (lokalt ofte tom). */
  vercelEnv: string | null;
  /** Vercel deployment-id (unik per deploy). */
  vercelDeploymentId: string | null;
  /** Git commit SHA for denne deployen (Vercel setter ved build fra Git). */
  gitCommitSha: string | null;
  /** Git branch. */
  gitCommitRef: string | null;
  /** Kort commit-melding hvis tilgjengelig. */
  gitCommitMessage: string | null;
  /** Vercel hostname for denne instansen (f.eks. tankestrommen-xxx.vercel.app). */
  vercelUrl: string | null;
  /** ISO-tidspunkt når fingerprint ble generert (request-tid; viser at koden kjører nå). */
  generatedAt: string;
}

function readPackageJsonVersion(): string {
  try {
    const p = join(process.cwd(), "package.json");
    const j = JSON.parse(readFileSync(p, "utf-8")) as { version?: string };
    return typeof j.version === "string" ? j.version : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Stabil produksjons-/deploy-fingerprint. Bruker Vercels innebygde miljøvariabler
 * når appen kjører på Vercel; lokalt vil mange felt være null.
 *
 * @see https://vercel.com/docs/projects/environment-variables/system-environment-variables
 */
export function getDeployFingerprint(): DeployFingerprint {
  const label = process.env.TANKESTROM_APP_VERSION?.trim() || null;
  return {
    app: "tankestrommen",
    packageVersion: readPackageJsonVersion(),
    appVersionLabel: label,
    vercelEnv: process.env.VERCEL_ENV?.trim() || null,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null,
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF?.trim() || null,
    gitCommitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE?.trim() || null,
    vercelUrl: process.env.VERCEL_URL?.trim() || null,
    generatedAt: new Date().toISOString(),
  };
}
