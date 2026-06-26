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

/**
 * Tydelige sportssignaler — slår av skole-klassifisering (konservativt). Delt i STERKE
 * (entydige cup-/idrettsord) og SVAKE/overlastede ord (`pulje`/`bane`) som også brukes i
 * skole-logistikk (eksamenspuljer, rom/«bane»). Sterke slår alltid av skole; svake kun når
 * det IKKE finnes sterke skolebevis (se `hasStrongSchoolEvidence`).
 */
const STRONG_SPORT_SIGNAL_RE =
  /\b(kamp|kampstart|kampoppsett|cup|turnering|stevne|sluttspill|seriekamp|avkast|fotball|handball|innebandy|volleyball|basket|ishockey|bandy|idrettslag)\b/;
/** Overlastede ord — kan bety sport ELLER skole-logistikk. */
const WEAK_SPORT_SIGNAL_RE = /\b(pulje|bane)\b/;
/** Union (sterk ∪ svak) — beholdt for grov dokumenttype-klassifisering (`cup_or_sport`). */
const SPORT_SIGNAL_RE =
  /\b(kamp|kampstart|kampoppsett|cup|turnering|stevne|sluttspill|seriekamp|avkast|fotball|handball|innebandy|volleyball|basket|ishockey|bandy|idrettslag|pulje|bane)\b/;

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
 * Sterke skolebevis: ≥2 distinkte klassekoder (2STA/2STB/…) OG minst ett tydelig skoleord
 * (eksamen/bokinnlevering/auditorium/…). Brukt til å la skole overstyre de overlastede
 * ordene `pulje`/`bane`, og til å gjenkjenne skole-aktivitetsplaner i overlay-deteksjonen.
 */
export function hasStrongSchoolEvidence(text: string): boolean {
  return countDistinctClassCodes(text) >= 2 && SCHOOL_WORD_RE.test(normalizeNorwegianLetters(text));
}

/** Normaliser en klassekode for sammenligning: små bokstaver, å/ø/æ-fold, uten whitespace. */
function normalizeClassCode(code: string): string {
  return normalizeNorwegianLetters(code).replace(/\s+/g, "");
}

/**
 * Konservativ klasse-relevans for én tekstlinje gitt elevens klassekode (Oppgave 7).
 * - Tom/ukjent elev-klasse → true (ingen kontekst, behold alt).
 * - Ingen klassekode i linja → true (gjelder alle klasser).
 * - Linja nevner elevens klasse → true.
 * - Linja nevner KUN andre klasser → false (filtreres bort).
 */
export function lineIsRelevantForClass(
  line: string,
  childClassCode: string | undefined,
): boolean {
  const child = childClassCode ? normalizeClassCode(childClassCode) : "";
  if (!child) return true;
  const matches = normalizeNorwegianLetters(line).match(CLASS_CODE_RE);
  if (!matches || matches.length === 0) return true;
  const codes = new Set(matches.map((m) => m.replace(/\s+/g, "")));
  return codes.has(child);
}

/**
 * True når teksten ser ut som skole-/klasseplan: flere klassekolonner (≥2 klassekoder) ELLER
 * tydelige skoleord — og INGEN tydelige sportssignaler.
 *
 * Konservativ prioritet: STERKE sportssignaler (kamp/cup/fotball/turnering/…) slår alltid av
 * skole. De OVERLASTEDE ordene `pulje`/`bane` (også vanlige i eksamens-/skole-logistikk) slår
 * KUN av skole når det ikke finnes sterke skolebevis (≥2 klassekoder OG skoleord) — slik at en
 * eksamensplan med «puljer» + 2STA–2STF + eksamen ikke feilklassifiseres som cup.
 */
export function looksLikeSchoolClassSchedule(text: string): boolean {
  const n = normalizeNorwegianLetters(text);
  if (STRONG_SPORT_SIGNAL_RE.test(n)) return false; // entydig sport → aldri skole
  if (hasStrongSchoolEvidence(text)) return true; // 2STA–2STF + eksamen slår pulje/bane
  if (WEAK_SPORT_SIGNAL_RE.test(n)) return false; // pulje/bane uten skolebevis → behandle som sport
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
