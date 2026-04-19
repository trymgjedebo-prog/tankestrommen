import { NextResponse } from "next/server";
import { getDeployFingerprint } from "@/lib/deploy-fingerprint";

export const runtime = "nodejs";
/** Alltid kjør på forespørsel — ellers kan Vercel bake inn fingerprint ved build. */
export const dynamic = "force-dynamic";

/**
 * GET /api/version — deploy-/build-fingerprint for å verifisere at produksjon
 * kjører forventet commit (uten å måtte analysere dokumenter).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    ...getDeployFingerprint(),
  });
}
