/**
 * Produksjonsadapter: bygger ett additivt `CanonicalSchoolContentDraft` fra EKSISTERENDE
 * `schoolBlockProposal` (autoritativ dag-scope + dagsoperasjon + audience + barnematch), fag-plassert
 * via de delte `NormalizedSchoolContentFact`-radene (`school-content-fact`) + eksisterende
 * deterministisk fagplassering (`resolveSchoolSubjectPlacement`).
 *
 * STRUKTURELT POENG: adapteren kobler IKKE lenger fag↔innhold ved tilfeldig lik prosa mellom to
 * ferdige sluttprodukter (overlay-seksjonslinje vs. schoolBlock-`sourceText`). I stedet konsumeres
 * ÉN normalisert fag/kategori-rad bygget FØR reduksjonen til ulik prosa. Hver fact bærer
 * `originalSourceText` = den rå feltverdien verbatim — SAMME streng schoolBlock bruker som
 * `sourceText` — så et fagplassert item og et schoolBlock-dagsitem for samme faktum kobles på
 * stabil kilde-identitet (`sourceFactId`/feltverdi), ikke på prosalikhet.
 *
 * Kjerneprinsipper:
 *  1. DAG-SCOPE: schoolBlock-dagen er autoritativ. En fact knyttes til en schoolBlock-dag KUN når
 *     dag-identitet matcher entydig (eksakt dato → entydig weekdayIndex). Overlayets ferdige
 *     `dailyActions` brukes ALDRI som dag-identitet. Ved manglende/tvetydig identitet: faktumet
 *     forblir på schoolBlock-dagen som dagsnivå.
 *  2. CHILD-AUDIENCE: `resolvedChildAudience`/`isChildAudience` filtreres faktisk.
 *  3. SPRÅKSPOR: et språk barnet ikke har (profil / overlay-languageTrack) blir IKKE dagsmelding —
 *     det utelates; uklart spor beholdes som dagsnivå MED review-flagg.
 *  4. Ett faktum → ett canonical item; samme faktum i flere seksjoner → mest spesifikke kategori.
 *
 * Ren: ingen Next.js/OpenAI/env/nettverk/sideeffekter; muterer aldri input. `null` uten schoolBlock.
 */
import {
  normalizeCanonicalSchoolContentDraft,
  type CanonicalSchoolContentDraft,
  type RawCanonicalSchoolContentInput,
  type RawCanonicalSchoolDay,
  type RawCanonicalSchoolItem,
} from "@/lib/school-content-canonical";
import {
  moreSpecificContentType,
  sectionKeyToContentType,
  type NormalizedSchoolContentFact,
} from "@/lib/school-content-fact";
import { isLanguageTrackSubjectKey } from "@/lib/school-language-track";
import { resolveSchoolSubjectPlacement } from "@/lib/school-subject-placement";
import type { PortalImportContext } from "@/lib/portal-import-person";
import type {
  SchoolBlockContentItem,
  SchoolBlockContentType,
  SchoolBlockDay,
  SchoolBlockProposal,
  SchoolBlockReviewCode,
  SchoolProfileWeekdayIndex,
  SchoolWeeklyProfile,
  SchoolWeekOverlayProposal,
} from "@/lib/types";

export interface CanonicalSchoolAdapterInput {
  schoolBlockProposal: SchoolBlockProposal | undefined;
  /** Kun for `languageTrack` (delt semantikk); fag hentes fra `normalizedSchoolContentFacts`. */
  schoolWeekOverlayProposal: SchoolWeekOverlayProposal | undefined;
  /** Delt, pre-projeksjons fag/kategori-rad (fra `buildNormalizedSchoolContentFacts`). */
  normalizedSchoolContentFacts: readonly NormalizedSchoolContentFact[];
  resolvedPersonContext: PortalImportContext;
  originalSourceType: string;
  sourceTitle: string;
}

/* Prioritet ved dedup innen dag: subject > resolved child audience > uoppløst audience > dag. */
const PRIO_SUBJECT = 0;
const PRIO_CHILD_AUDIENCE = 1;
const PRIO_UNRESOLVED_AUDIENCE = 2;
const PRIO_DAY = 3;

function normalizeVisibleText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}
/** Eksakt-match-nøkkel (case-insensitiv) for feltverdi-kobling/dedup. */
function textKey(raw: string | null): string | null {
  return raw === null ? null : raw.toLowerCase();
}

function subjectKeyInWeeklyProfile(profile: SchoolWeeklyProfile | null, subjectKey: string): boolean {
  if (!profile || typeof profile !== "object" || !profile.weekdays) return false;
  for (const day of Object.values(profile.weekdays)) {
    if (!day || day.useSimpleDay === true) continue;
    if (Array.isArray(day.lessons) && day.lessons.some((l) => l.subjectKey === subjectKey)) return true;
  }
  return false;
}

type BuiltItem = { raw: RawCanonicalSchoolItem; priority: number; dedupeKey: string | null };

/* ── Audience-filtrering (faktisk child-scoping) ──────────────────────────── */

function toRawAudienceEntry(a: SchoolBlockContentItem["audienceEntries"][number]) {
  return { classCodes: a.classCodes, pulje: a.pulje, start: a.start, end: a.end, room: a.room, teacher: a.teacher, isChildAudience: a.isChildAudience };
}

/** Bygg ett schoolBlock-innhold → child-scoped canonical item(er), eller `null` (utelates). */
function buildBlockItem(item: SchoolBlockContentItem): BuiltItem | null {
  const dedupeKey = textKey(normalizeVisibleText(item.sourceText));
  const reviewFlags = item.reviewFlags.length > 0 ? item.reviewFlags.map((f) => ({ ...f, scope: { ...f.scope } })) : undefined;

  if (item.audienceScope === "per_audience" && item.audienceEntries.length > 0) {
    // A. Sikkert oppløst barn-audience → bare barnets entry.
    if (item.resolvedChildAudience) {
      const rca = item.resolvedChildAudience;
      const orig = item.audienceEntries.find((a) => a.audienceEntryId === rca.audienceEntryId) ?? item.audienceEntries[0]!;
      return {
        priority: PRIO_CHILD_AUDIENCE, dedupeKey,
        raw: {
          placement: "audience", contentType: item.contentType, customLabel: item.customLabel,
          start: rca.start, end: rca.end,
          audienceEntries: [{ classCodes: orig.classCodes, pulje: orig.pulje, start: rca.start, end: rca.end, room: rca.room, teacher: rca.teacher, isChildAudience: true }],
          sourceText: normalizeVisibleText(item.sourceText), confidence: item.confidence, reviewFlags,
        },
      };
    }
    // B. Eksplisitt true/false → behold kun true; alle false → utelat.
    const trueEntries = item.audienceEntries.filter((a) => a.isChildAudience === true);
    if (trueEntries.length > 0) {
      return {
        priority: PRIO_CHILD_AUDIENCE, dedupeKey,
        raw: {
          placement: "audience", contentType: item.contentType, customLabel: item.customLabel,
          start: trueEntries[0]!.start, end: trueEntries[0]!.end,
          audienceEntries: trueEntries.map(toRawAudienceEntry),
          sourceText: normalizeVisibleText(item.sourceText), confidence: item.confidence, reviewFlags,
        },
      };
    }
    if (item.audienceEntries.every((a) => a.isChildAudience === false)) return null; // ikke barnets → utelat
    // C. Ukjent audience (alle null / blandet uten true) → uoppløst, ikke sikkert child-scoped.
    return {
      priority: PRIO_UNRESOLVED_AUDIENCE, dedupeKey,
      raw: {
        placement: "audience", contentType: item.contentType, customLabel: item.customLabel,
        start: item.audienceEntries[0]!.start, end: item.audienceEntries[0]!.end,
        audienceEntries: item.audienceEntries.map(toRawAudienceEntry),
        sourceText: normalizeVisibleText(item.sourceText), confidence: item.confidence,
        reviewFlags: [
          ...(reviewFlags ?? []),
          { code: "child_class_unresolved", message: "Klasse-/pulje-tilhørighet kunne ikke oppløses for barnet.", scope: {} },
        ],
      },
    };
  }

  // Vanlig dagsinformasjon (common).
  const dl = item.sections?.descriptionLines;
  return {
    priority: PRIO_DAY, dedupeKey,
    raw: {
      placement: "day", contentType: item.contentType, customLabel: item.customLabel,
      sections: Array.isArray(dl) && dl.length > 0 ? { descriptionLines: [...dl] } : undefined,
      sourceText: normalizeVisibleText(item.sourceText), confidence: item.confidence, reviewFlags,
    },
  };
}

/* ── Fact → fagbeslutning (fagplassering + språkspor) ─────────────────────── */

type FactDecision =
  | { kind: "subject"; contentType: SchoolBlockContentType; subject: string | null; subjectKey: string; start: string | null; end: string | null; reviewCode: SchoolBlockReviewCode | null }
  | { kind: "drop" } // ikke-matchende språk → utelat feltet fra child-draft
  | { kind: "review"; reviewCode: SchoolBlockReviewCode } // uklart språkspor → behold dagsnivå + flagg
  | { kind: "skip" }; // uoppløst fag → behold schoolBlock-dagsitem uendret

function decideFact(
  fact: NormalizedSchoolContentFact,
  weekdayIndex: SchoolProfileWeekdayIndex | null,
  childProfile: SchoolWeeklyProfile | null,
  overlayTrack: string | null,
): FactDecision {
  const decision = resolveSchoolSubjectPlacement(
    { subjectKey: fact.subjectKey, subject: fact.subject, customLabel: fact.customLabel, subjectCandidates: undefined, start: null, end: null, action: "enrich" },
    { weekdayIndex, schoolWeeklyProfile: childProfile },
  );
  if (decision.status !== "placed") return { kind: "skip" };

  const S = decision.subjectKey;
  const contentType = sectionKeyToContentType(fact.sectionKey);
  const placed = (): FactDecision => {
    const start = decision.lessonDecision.status === "matched" ? decision.lessonDecision.lesson.start : null;
    const end = decision.lessonDecision.status === "matched" ? decision.lessonDecision.lesson.end : null;
    return { kind: "subject", contentType, subject: decision.subject, subjectKey: S, start, end, reviewCode: decision.reviewCode };
  };

  if (isLanguageTrackSubjectKey(S)) {
    if (subjectKeyInWeeklyProfile(childProfile, S)) return placed();
    if (childProfile !== null) return { kind: "drop" }; // barnet har et annet språkspor
    if (overlayTrack !== null) return S === overlayTrack ? placed() : { kind: "drop" };
    return { kind: "review", reviewCode: decision.reviewCode ?? "ambiguous_subject" }; // uklart spor
  }
  return placed();
}

/* ── Dedup per dag ────────────────────────────────────────────────────────── */

function dedupePerDay(items: BuiltItem[]): RawCanonicalSchoolItem[] {
  const byKey = new Map<string, BuiltItem>();
  const noKey: BuiltItem[] = [];
  for (const it of items) {
    if (it.dedupeKey === null) { noKey.push(it); continue; }
    const existing = byKey.get(it.dedupeKey);
    if (!existing || it.priority < existing.priority) byKey.set(it.dedupeKey, it);
  }
  const deduped = [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || a[1].priority - b[1].priority);
  return [...deduped.map(([, v]) => v.raw), ...noKey.map((x) => x.raw)];
}

/* ── Dag-identitet: knytt en fact til en schoolBlock-dag (aldri via overlay dailyActions) ── */

function resolveFactDay(fact: NormalizedSchoolContentFact, days: readonly SchoolBlockDay[]): SchoolBlockDay | null {
  if (fact.date !== null) {
    const byDate = days.filter((d) => d.date !== null && d.date === fact.date);
    if (byDate.length === 1) return byDate[0]!;
    if (byDate.length > 1) return null; // tvetydig → ikke gjett
  }
  if (fact.weekdayIndex !== null) {
    const byWk = days.filter((d) => d.weekdayIndex !== null && d.weekdayIndex === fact.weekdayIndex);
    if (byWk.length === 1) return byWk[0]!;
  }
  return null; // manglende/tvetydig dag-identitet → forblir dagsnivå
}

/* ── Offentlig API ────────────────────────────────────────────────────────── */

export function buildCanonicalSchoolContentDraft(
  input: CanonicalSchoolAdapterInput,
): CanonicalSchoolContentDraft | null {
  const block = input.schoolBlockProposal;
  if (!block || !Array.isArray(block.days) || block.days.length === 0) return null;

  const childProfile = input.resolvedPersonContext.relevanceContext?.schoolProfile ?? null;
  const overlayTrack = input.schoolWeekOverlayProposal?.languageTrack?.resolvedTrack ?? null;

  // Fordel fakta til autoritative schoolBlock-dager via dag-identitet (aldri overlay dailyActions).
  const factsByDayId = new Map<string, NormalizedSchoolContentFact[]>();
  for (const fact of input.normalizedSchoolContentFacts) {
    const day = resolveFactDay(fact, block.days);
    if (!day) continue; // uoppløst dag → faktumet forblir dagsnivå via schoolBlock
    const list = factsByDayId.get(day.dayId) ?? [];
    list.push(fact);
    factsByDayId.set(day.dayId, list);
  }

  const days: RawCanonicalSchoolDay[] = block.days.map((day) => {
    const blockItems = (day.contentItems ?? []).map(buildBlockItem).filter((x): x is BuiltItem => x !== null);
    const facts = factsByDayId.get(day.dayId) ?? [];

    // Grupper fakta på KILDECONTAINER (ikke enkeltfaktum) — supersede vurderes per hel container.
    const containers = new Map<string, NormalizedSchoolContentFact[]>();
    for (const fact of facts) {
      const list = containers.get(fact.sourceContainerId) ?? [];
      list.push(fact);
      containers.set(fact.sourceContainerId, list);
    }

    // Enkeltfaktum → subject-item, gruppert på `sourceFactId` (samme faktum i flere seksjoner → ett
    // item, mest spesifikke kategori vinner). To ulike tekster/fag → ulik sourceFactId → to items.
    type SubjGroup = { sourceFactId: string; contentType: SchoolBlockContentType; subject: string | null; subjectKey: string; start: string | null; end: string | null; reviewCode: SchoolBlockReviewCode | null; text: string; originalSourceText: string; customLabel: string | null; confidence: number };
    const subjectByFactId = new Map<string, SubjGroup>();
    const supersededOriginals = new Set<string>(); // container fjernes KUN når hele containeren er dekket
    const reviewOriginals = new Map<string, SchoolBlockReviewCode>(); // uklart språk → dagsnivå + flagg

    for (const containerFacts of containers.values()) {
      const decisions = containerFacts.map((fact) => ({ fact, d: decideFact(fact, day.weekdayIndex, childProfile, overlayTrack) }));
      // Trygt å supersede HELE kildecontaineren kun når den er `full` OG hvert child-relevant faktum
      // har en definitiv disposisjon (fagplassert eller bevisst språk-utelatt). Uklart/uoppløst
      // (skip/review) eller `partial` → behold hele containeren på dagsnivå (ingen bred supersede).
      const coverageFull = containerFacts[0]!.sourceCoverage === "full";
      const allDefinite = decisions.every(({ d }) => d.kind === "subject" || d.kind === "drop");
      const origKey = textKey(normalizeVisibleText(containerFacts[0]!.originalSourceText));

      if (!(coverageFull && allDefinite)) {
        for (const { fact, d } of decisions) {
          if (d.kind !== "review") continue;
          const key = textKey(normalizeVisibleText(fact.originalSourceText));
          if (key !== null && !supersededOriginals.has(key)) reviewOriginals.set(key, d.reviewCode);
        }
        continue; // ingen subject-items fra en ikke-fullstendig dekket container
      }

      if (origKey !== null) { supersededOriginals.add(origKey); reviewOriginals.delete(origKey); }
      for (const { fact, d } of decisions) {
        if (d.kind !== "subject") continue; // drop → utelatt (block-common allerede superseded)
        const existing = subjectByFactId.get(fact.sourceFactId);
        if (!existing) {
          subjectByFactId.set(fact.sourceFactId, { sourceFactId: fact.sourceFactId, contentType: d.contentType, subject: d.subject, subjectKey: d.subjectKey, start: d.start, end: d.end, reviewCode: d.reviewCode, text: fact.text, originalSourceText: fact.originalSourceText, customLabel: fact.customLabel, confidence: fact.confidence });
        } else {
          existing.contentType = moreSpecificContentType(existing.contentType, d.contentType); // §8
          existing.start = existing.start ?? d.start;
          existing.end = existing.end ?? d.end;
          existing.reviewCode = existing.reviewCode ?? d.reviewCode;
        }
      }
    }

    // schoolBlock-items: fjern common KUN når hele kildecontaineren er dekket; flagg uklart-språk-common.
    const keptBlock: BuiltItem[] = [];
    for (const it of blockItems) {
      if (it.priority === PRIO_DAY && it.dedupeKey !== null && supersededOriginals.has(it.dedupeKey)) continue; // hel container superseded
      if (it.priority === PRIO_DAY && it.dedupeKey !== null && reviewOriginals.has(it.dedupeKey)) {
        const code = reviewOriginals.get(it.dedupeKey)!;
        keptBlock.push({ ...it, raw: { ...it.raw, reviewFlags: [...(it.raw.reviewFlags ?? []), { code, message: "Språkspor kunne ikke fastslås sikkert for barnet.", scope: {} }] } });
        continue;
      }
      keptBlock.push(it);
    }

    const subjectItems: RawCanonicalSchoolItem[] = [...subjectByFactId.values()].map((g) => ({
      placement: "subject", contentType: g.contentType, subject: g.subject, subjectKey: g.subjectKey, customLabel: g.customLabel,
      start: g.start, end: g.end,
      sourceText: g.text, // §5: den enkelte factens SYNLIGE tekst (ikke hele containeren)
      evidence: g.originalSourceText, // §5: original kilde-evidens bevart
      sourceRef: g.sourceFactId, // stabil enkeltfaktum-identitet
      confidence: g.confidence,
      reviewFlags: g.reviewCode ? [{ code: g.reviewCode, message: "Fagøkt kunne ikke fastslås sikkert.", scope: {} }] : undefined,
    }));

    return {
      date: day.date, weekdayIndex: day.weekdayIndex, dayLabel: day.dayLabel,
      dayOperation: day.dayOperation, confidence: day.confidence, evidence: day.evidence,
      reviewFlags: day.reviewFlags.map((f) => ({ ...f, scope: { ...f.scope } })),
      items: [...subjectItems, ...dedupePerDay(keptBlock)],
    };
  });

  const rawInput: RawCanonicalSchoolContentInput = {
    sourceTitle: input.sourceTitle,
    originalSourceType: input.originalSourceType,
    personId: block.personId,
    personMatchStatus: block.personMatchStatus,
    classCode: block.classCode,
    reviewFlags: block.reviewFlags.map((f) => ({ ...f, scope: { ...f.scope } })),
    days,
  };
  return normalizeCanonicalSchoolContentDraft(rawInput);
}
