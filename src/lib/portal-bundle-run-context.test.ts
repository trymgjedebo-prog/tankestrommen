/**
 * Tester for den additive `PortalBundleRunContext` på `toPortalBundle`. De DIREKTE volatile feltene
 * (`schoolBlockProposal.proposalId`, `provenance.importRunId`, `provenance.generatedAt`) blir
 * injiserbare og dermed deterministiske. Uten run context beholdes dagens oppførsel (UUID + nåtid).
 *
 * MERK (utenfor scope, jf. §6): `items[].proposalId` og `items[].sourceId` genereres INNE i
 * PortalBundleRuntime-callbacks (route.ts) og kontrolleres IKKE av run context ennå — de er de
 * ENESTE gjenværende ukontrollerte UUID-ene i bundlen (bekreftet: resten er deterministisk med run
 * context; draftens sourceId-er er djb2-hasher). De fjernes eksplisitt i sammenligningene under
 * (`stripRuntimeItemIds`) og hører til en senere runtime-ekstraksjon.
 *
 * Bruker eksisterende runtime-oppsett (side-effekt-import av route) — ikke en ny replay-runtime.
 */
import { describe, expect, it } from "vitest";
import "@/app/api/analyze/route"; // eksisterende testoppsett: registrerer PortalBundleRuntime
import { toPortalBundle, type PortalBundleRunContext } from "@/lib/portal-bundle";
import { makeSchoolBlockWeekResultWithDayOperations, makeChildren } from "@/lib/fixtures/school-block-week.fixture";
import type { PortalImportContext } from "@/lib/portal-import-person";

const CTX = (): PortalImportContext => ({ knownPersons: [], children: makeChildren() });
const FIXED = new Date("2026-06-01T00:00:00.000Z");
function makeIdGenerator() {
  const ids = ["id-1", "id-2", "id-3", "id-4"];
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("ID generator exhausted");
    return id;
  };
}
type Bundle = Record<string, unknown>;
async function bundle(runContext?: PortalBundleRunContext, args5 = false): Promise<Bundle> {
  const result = makeSchoolBlockWeekResultWithDayOperations();
  return args5
    ? await toPortalBundle(result, "text", "school" as never, false, CTX())
    : await toPortalBundle(result, "text", "school" as never, false, CTX(), runContext);
}
/** Fjern KUN de dokumenterte runtime-callback-ID-ene (`proposalId`/`sourceId` i items, utenfor scope). */
function scrubKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "proposalId" || k === "sourceId") continue;
      out[k] = scrubKeys(val);
    }
    return out;
  }
  return v;
}
function stripRuntimeItemIds(b: Bundle): Bundle {
  const clone = JSON.parse(JSON.stringify(b)) as Bundle;
  if (Array.isArray(clone.items)) clone.items = (clone.items as unknown[]).map(scrubKeys);
  return clone;
}
/** Fjern de tre DIREKTE volatile feltene + runtime-item-ID-ene (for paritet mellom to random-kall). */
function stripAllVolatile(b: Bundle): Bundle {
  const clone = stripRuntimeItemIds(b);
  const prov = clone.provenance as Record<string, unknown> | undefined;
  if (prov) { delete prov.generatedAt; delete prov.importRunId; }
  const sbp = clone.schoolBlockProposal as Record<string, unknown> | undefined;
  if (sbp) delete sbp.proposalId;
  return clone;
}

describe("stabil tid og ID via run context", () => {
  it("fast now → provenance.generatedAt er stabil og lik injisert dato", async () => {
    const b = await bundle({ now: FIXED, newId: makeIdGenerator() });
    expect((b.provenance as { generatedAt: string }).generatedAt).toBe(FIXED.toISOString());
  });

  it("deterministisk generator → proposalId og importRunId er forutsigbare", async () => {
    const b = await bundle({ now: FIXED, newId: makeIdGenerator() });
    expect((b.schoolBlockProposal as { proposalId: string }).proposalId).toBe("id-1");
    expect((b.provenance as { importRunId: string }).importRunId).toBe("id-2");
  });
});

describe("determinisme", () => {
  it("to kjøringer med samme faste dato + hver sin identiske ID-sekvens → dyp likhet (utenom runtime-item-ID)", async () => {
    const a = await bundle({ now: FIXED, newId: makeIdGenerator() });
    const b = await bundle({ now: FIXED, newId: makeIdGenerator() });
    expect(stripRuntimeItemIds(a)).toEqual(stripRuntimeItemIds(b));
    // de tre direkte volatile feltene er identiske (ikke bare «lik struktur»):
    expect((a.schoolBlockProposal as { proposalId: string }).proposalId).toBe((b.schoolBlockProposal as { proposalId: string }).proposalId);
    expect((a.provenance as { importRunId: string }).importRunId).toBe((b.provenance as { importRunId: string }).importRunId);
    expect((a.provenance as { generatedAt: string }).generatedAt).toBe((b.provenance as { generatedAt: string }).generatedAt);
  });
});

describe("standardoppførsel (uten run context)", () => {
  it("gyldige UUID-er og ISO-timestamp beholdes", async () => {
    const b = await bundle();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect((b.schoolBlockProposal as { proposalId: string }).proposalId).toMatch(uuid);
    expect((b.provenance as { importRunId: string }).importRunId).toMatch(uuid);
    expect((b.provenance as { generatedAt: string }).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("produksjonsparitet (§10)", () => {
  it("gammel 5-arg-kallform vs ny 6-arg (runContext undefined) → identisk semantikk (utenom volatile)", async () => {
    const old5 = await bundle(undefined, true);
    const new6 = await bundle(undefined, false);
    expect(stripAllVolatile(new6)).toEqual(stripAllVolatile(old5));
    // semantiske skolefelt finnes og er uendret i form:
    expect(new6.schoolBlockProposal).toBeTruthy();
    expect(new6.canonicalSchoolContentDraft).toBeTruthy();
    expect(new6.evidenceReport).toBeTruthy();
    expect(new6.schemaVersion).toBe("1.0.0");
  });

  it("full dyp determinisme med injisert run context (utenom dokumenterte runtime-item-ID)", async () => {
    const a = await bundle({ now: FIXED, newId: makeIdGenerator() });
    const b = await bundle({ now: FIXED, newId: makeIdGenerator() });
    expect(stripRuntimeItemIds(a)).toEqual(stripRuntimeItemIds(b));
  });
});

describe("immutabilitet", () => {
  it("input-resultat og run context muteres ikke", async () => {
    const result = makeSchoolBlockWeekResultWithDayOperations();
    const resultSnap = JSON.stringify(result);
    const rc: PortalBundleRunContext = { now: FIXED, newId: makeIdGenerator() };
    await toPortalBundle(result, "text", "school" as never, false, CTX(), rc);
    expect(JSON.stringify(result)).toBe(resultSnap);
    expect(rc.now).toBe(FIXED); // now-referansen er urørt
  });
});
