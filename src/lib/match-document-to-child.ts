/**
 * Vei 1, lag 1: ren, isolert matcher som velger HVILKET barn et dokument gjelder, basert på
 * klassekoder (primært) og trinn (sekundært). VGS-først; ungdomsskole («10B») er et senere steg
 * som kun utvider dekningen additivt.
 *
 * Trygg fallback: velg ALDRI ved tvil — returner `personId: null` + status, så lar laget over
 * (route.ts, senere) brukeren velge. Ingen route.ts-/kontrakt-avhengighet (ren funksjon).
 */
import { mapOneGradeBandHint } from "@/lib/ai/analyze-image";
import { extractClassCodes, normalizeClassCode } from "@/lib/school-class-schedule";
import type { SchoolProfileGradeBand, SchoolWeeklyProfile } from "@/lib/types";

export type MatchChild = {
  personId: string;
  classCode: string;
  schoolProfile?: SchoolWeeklyProfile | null;
};

export type MatchDocumentToChildResult =
  | { personId: string; status: "matched" }
  | { personId: null; status: "ambiguous" | "no_signal" };

/** Barnets trinn: foretrekk lagret schoolProfile.gradeBand, ellers utled fra classCode (VGS). */
function childGradeBand(child: MatchChild): SchoolProfileGradeBand | null {
  return (
    child.schoolProfile?.gradeBand ??
    (child.classCode.trim() ? mapOneGradeBandHint(child.classCode) : null)
  );
}

/**
 * Velg barnet et dokument gjelder. Primær: nøyaktig ett barns klassekode står literalt i
 * dokumentet → matched. Sekundær (når ingen eksakt kode): dokumentets trinn (utledet fra dets
 * klassekoder) peker entydig på ett barn → matched. Ellers null + "ambiguous"/"no_signal".
 */
export function matchDocumentToChild(
  documentText: string,
  children: MatchChild[],
): MatchDocumentToChildResult {
  // Kun gyldige barn (personId + ikke-tom classCode).
  const valid = children.filter(
    (c) => Boolean(c.personId) && typeof c.classCode === "string" && c.classCode.trim() !== "",
  );
  if (valid.length === 0) return { personId: null, status: "no_signal" };

  const docCodes = new Set(extractClassCodes(documentText));

  // PRIMÆR: eksakt klassekode-match (begge sider via normalizeClassCode → konsistent normalisering).
  if (docCodes.size > 0) {
    const exact = valid.filter((c) => docCodes.has(normalizeClassCode(c.classCode)));
    if (exact.length === 1) return { personId: exact[0]!.personId, status: "matched" };
    if (exact.length >= 2) return { personId: null, status: "ambiguous" };
  }

  // SEKUNDÆR: trinn — kun når ingen eksakt kode matchet. Fanger «2STA–2STF» (range → vg2),
  // der barnets literale kode (2STC) ikke står skrevet, men trinnet er entydig.
  const docBands = new Set<SchoolProfileGradeBand>(
    Array.from(docCodes, (code) => mapOneGradeBandHint(code)).filter(
      (b): b is SchoolProfileGradeBand => b !== null,
    ),
  );
  if (docBands.size > 0) {
    const bandMatches = valid.filter((c) => {
      const b = childGradeBand(c);
      return b !== null && docBands.has(b);
    });
    if (bandMatches.length === 1) return { personId: bandMatches[0]!.personId, status: "matched" };
    if (bandMatches.length >= 2) return { personId: null, status: "ambiguous" };
  }

  // FALLBACK: ingen entydig match → la brukeren velge.
  return { personId: null, status: "no_signal" };
}
