import { NextResponse } from "next/server";
import { getDeployFingerprint } from "@/lib/deploy-fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — kort status + samme fingerprint som /api/version (for overvåking). */
export async function GET() {
  const fp = getDeployFingerprint();
  return NextResponse.json({
    status: "ok",
    app: fp.app,
    packageVersion: fp.packageVersion,
    appVersionLabel: fp.appVersionLabel,
    gitCommitSha: fp.gitCommitSha,
    vercelDeploymentId: fp.vercelDeploymentId,
    vercelEnv: fp.vercelEnv,
    generatedAt: fp.generatedAt,
  });
}
