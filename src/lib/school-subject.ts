/**
 * Delte, rene fagprimitiver for skoledata. Ingen AI-/Next.js-/OpenAI-avhengigheter, ingen
 * miljøvariabler, ingen nettverk, ingen sideeffekter, ingen prompttekst. Modulen kjenner
 * verken schoolWeekOverlayProposal eller schoolBlockProposal, og gjør hverken timetable- eller
 * audience-matching — den oversetter bare rå fagtekst til stabile `subjectKey`-slugs og kjente
 * kanoniske fag.
 *
 * Funksjonene er SEMANTISK UENDREDE flyttinger fra `analyze-image.ts` (samme implementasjon,
 * samme rekkefølge på `CANONICAL_SUBJECTS`, samme aliaser). De samles her slik at senere
 * fagplassering (school-subject-placement) kan importere dem uten å dra inn AI-analysefilen og
 * uten å duplisere faglogikk. `normalizeNorwegianLetters`/`normalizeSpace` er små private kopier
 * (samme mønster som `school-date.ts` / `school-weekday.ts`) for å holde modulen selvstendig.
 */

/** Privat kopi (som ellers duplisert i repoet) for eksakt bevaring av bokstav-foldingen. */
function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

/** Privat kopi: kollaps whitespace til ett mellomrom og trim. */
function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Slug fra rå fagtekst («Kroppsøving» → «kroppsoving»). For kort (<2) → null. */
export function slugifySubjectKey(raw: string): string | null {
  const s = normalizeSpace(raw);
  if (s.length < 2) return null;
  const slug = normalizeNorwegianLetters(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

export interface CanonicalSubject {
  /** Intern `subjectKey` (bindestrek-slug), matcher det Foreldre-App bruker. */
  subjectKey: string;
  /** Lesbart norsk fagnavn. */
  displayName: string;
  /** Alias-tokens (allerede normaliserte: små bokstaver, æ→e, ø→o, å→a, kun bokstaver). */
  aliases: string[];
}

export const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  {
    subjectKey: "norsk",
    displayName: "Norsk",
    // Ikke «no»/«nor» — for ofte falsk positiv (OCR/modell). Celle må vise
    // «Norsk», «NO», «Norsk D1/D2» via cellTextAllowsNorskSubjectEvidence.
    aliases: ["norsk", "norsk-hovedmal", "norsk-sidemal"],
  },
  {
    subjectKey: "matematikk",
    displayName: "Matematikk",
    aliases: ["matematikk", "matte", "mat", "ma", "mat1p", "mat1t", "matta"],
  },
  {
    subjectKey: "engelsk",
    displayName: "Engelsk",
    aliases: ["engelsk", "eng", "english"],
  },
  {
    subjectKey: "naturfag",
    displayName: "Naturfag",
    aliases: ["naturfag", "natur", "nat"],
  },
  {
    subjectKey: "samfunnsfag",
    displayName: "Samfunnsfag",
    aliases: ["samfunnsfag", "samf", "samfunn"],
  },
  {
    subjectKey: "krle",
    displayName: "KRLE",
    aliases: ["krle", "rle", "krl", "kr-le", "krle-livssyn"],
  },
  {
    subjectKey: "kroppsoving",
    displayName: "Kroppsøving",
    aliases: ["kroppsoving", "kroppsov", "kropp", "gym", "kroppsovning", "kroppsoeving"],
  },
  {
    subjectKey: "musikk",
    displayName: "Musikk",
    aliases: ["musikk", "mus"],
  },
  {
    subjectKey: "kunst-og-handverk",
    displayName: "Kunst og håndverk",
    // Kun fulle/entydige varianter. «K&H», «K/H», «KH» holdes rå via fallback
    // fordi de kan være tvetydige på enkelte skoler.
    aliases: ["kunstoghandverk", "kunst-og-handverk"],
  },
  {
    subjectKey: "mat-og-helse",
    displayName: "Mat og helse",
    aliases: ["matoghelse", "mat-og-helse", "mat-helse"],
  },
  {
    subjectKey: "utdanningsvalg",
    displayName: "Utdanningsvalg",
    // Utelatt "utv"/"utd" med vilje – noen skoler bruker UTV med ulik betydning,
    // og konservativ fallback er tryggere enn feil mapping.
    aliases: ["utdanningsvalg"],
  },
  {
    subjectKey: "valgfag",
    displayName: "Valgfag",
    aliases: ["valgfag", "valg"],
  },
  {
    subjectKey: "spansk",
    displayName: "Spansk",
    aliases: ["spansk", "spa"],
  },
  {
    subjectKey: "tysk",
    displayName: "Tysk",
    aliases: ["tysk", "ty"],
  },
  {
    subjectKey: "fransk",
    displayName: "Fransk",
    aliases: ["fransk", "fra"],
  },
  {
    subjectKey: "historie",
    displayName: "Historie",
    aliases: ["historie", "hist"],
  },
  {
    subjectKey: "geografi",
    displayName: "Geografi",
    aliases: ["geografi", "geo"],
  },
];

/** Normaliser en tekst til et alias-friendly token (a-z0-9 kun, æøå foldet). */
function subjectAliasKey(raw: string): string {
  return normalizeNorwegianLetters(raw)
    .replace(/&/g, " og ")
    .replace(/\//g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Prøv å matche en tekst (eks. «K&H», «KRLE», «Kroppsøving») mot kanoniske fag.
 * Returner første kanonisk match eller null.
 */
export function canonicalizeSubjectFromText(
  text: string | null,
): CanonicalSubject | null {
  if (!text) return null;
  const key = subjectAliasKey(text);
  if (!key) return null;
  // Eksakt alias-treff først.
  for (const s of CANONICAL_SUBJECTS) {
    if (s.aliases.includes(key)) return s;
  }
  // «Kortform + annet» (f.eks. «krle-livssyn», «mat-og-helse-nb»): alias som prefix.
  for (const s of CANONICAL_SUBJECTS) {
    for (const a of s.aliases) {
      if (a.length >= 3 && key.startsWith(a)) return s;
    }
  }
  // Ord-by-ord: hvis noe av inputs ordtokens matcher en alias.
  const words = normalizeNorwegianLetters(text)
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    for (const s of CANONICAL_SUBJECTS) {
      if (s.aliases.includes(w)) return s;
    }
  }
  return null;
}

/** Prøv flere kilder (f.eks. subjectKey, subject, customLabel) i rekkefølge. */
export function canonicalizeSubjectFromStrings(
  sources: Array<string | null | undefined>,
): CanonicalSubject | null {
  for (const s of sources) {
    if (!s) continue;
    const found = canonicalizeSubjectFromText(s);
    if (found) return found;
  }
  return null;
}

/** Prefix som markerer at faget IKKE kunne mappes til et kjent kanonisk fag. */
export const CUSTOM_SUBJECT_PREFIX = "custom:";

/**
 * Bygg en konservativ `subjectKey` for ukjente/usikre fag. Beholder rå tekst
 * som differensiator slik at ulike ukjente fag ikke kolliderer i dedup.
 * Eksempler:
 *   «UTV»      → "custom:utv"
 *   «K&H»      → "custom:k-h"   (& → "-")
 *   «Språk»    → "custom:sprak"
 */
export function buildCustomSubjectKey(rawText: string): string {
  const slug =
    normalizeNorwegianLetters(rawText)
      .replace(/&/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ukjent";
  return `${CUSTOM_SUBJECT_PREFIX}${slug}`;
}
