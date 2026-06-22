/**
 * Deterministisk deteksjon av skole-/klasseplan vs. cup-/sportstekst. Delt mellom
 * produksjonsstien (`/api/analyze`) og eval-runneren, slik at test og produksjon ikke divergerer.
 *
 * Mål (PR 1, relevansprofil): et dokument som ser ut som skole-/klasseplan skal IKKE behandles
 * som cup → tidspunkter skal ikke få «Første kamp»/«Andre kamp»-labels, men nøytrale/skolefaglige.
 *
 * Konservativ prioritet: tydelige sportssignaler (kamp/cup/bane/pulje/fotball/håndball …) slår
 * alltid av skole-klassifiseringen. Først når det er klassekolonner/skoleord UTEN sportssignal,
 * regnes dokumentet som skole-/klasseplan.
 */

function normalizeNorwegianLetters(input: string): string {
  return input
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ø/g, "o")
    .replace(/æ/g, "e");
}

/** Tydelige sportssignaler — slår av skole-klassifisering (konservativt). */
const SPORT_SIGNAL_RE =
  /\b(kamp|kampstart|kampoppsett|cup|turnering|stevne|sluttspill|seriekamp|pulje|avkast|fotball|handball|innebandy|volleyball|basket|ishockey|bandy|idrettslag|bane)\b/;

/** Tydelige skole-/klasseord (på normalisert tekst: å→a, ø→o, æ→e). */
const SCHOOL_WORD_RE =
  /\b(skole|skoleplan|skoledag|ukeplan|aktivitetsplan|klasse|klasseopplegg|klasserom|trinn|auditorium|bokinnlevering|radgiver|radgivning|eksamen|undervisning|elevsamtale|fagdag|laerer|vurderingssituasjon)\b/;

/** Norske VGS-klassekoder, f.eks. 2STA, 2STB, 1IMA, 3PBA. */
const CLASS_CODE_RE = /\b\d{1,2}\s?(?:st|im|yf|pb|el|hs|sf|mk|id|na|ss|rm|dh|ba|tip|ho)[a-f]\b/gi;

/** Distinkte klassekoder (2STA, 2STB, …) i teksten. */
export function countDistinctClassCodes(text: string): number {
  const n = normalizeNorwegianLetters(text);
  const matches = n.match(CLASS_CODE_RE) ?? [];
  return new Set(matches.map((m) => m.replace(/\s+/g, ""))).size;
}

/**
 * True når teksten ser ut som skole-/klasseplan: flere klassekolonner (≥2 klassekoder) ELLER
 * tydelige skoleord — og INGEN tydelige sportssignaler.
 */
export function looksLikeSchoolClassSchedule(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  if (SPORT_SIGNAL_RE.test(n)) return false;
  if (countDistinctClassCodes(text) >= 2) return true;
  return SCHOOL_WORD_RE.test(n);
}

export type TankestromDocumentKind = "school_class_schedule" | "cup_or_sport" | "unknown";

/**
 * Grov dokumenttype-klassifisering (intern grunnmur for senere relevansprofil).
 * Filtrerer ikke på barnets klasse — kun dokumenttype.
 */
export function classifyTankestromDocumentKind(text: string): TankestromDocumentKind {
  if (looksLikeSchoolClassSchedule(text)) return "school_class_schedule";
  if (SPORT_SIGNAL_RE.test(normalizeNorwegianLetters(text))) return "cup_or_sport";
  return "unknown";
}
