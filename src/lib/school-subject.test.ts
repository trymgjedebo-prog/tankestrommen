/**
 * Parity-tester for de delte fagprimitivene. Dokumenterer EKSISTERENDE atferd flyttet fra
 * analyze-image.ts (ingen ny produktsemantikk): slugging, kanonisering fra tekst/flere kilder,
 * custom-key-bygging, casing/tegnsetting/norske bokstaver, ukjent-fag-håndtering, determinisme
 * og fravær av inputmutasjon.
 */
import { describe, expect, it } from "vitest";
import {
  buildCustomSubjectKey,
  canonicalizeSubjectFromStrings,
  canonicalizeSubjectFromText,
  CANONICAL_SUBJECTS,
  CUSTOM_SUBJECT_PREFIX,
  slugifySubjectKey,
} from "@/lib/school-subject";

describe("slugifySubjectKey", () => {
  it("slugger fagnavn med norske bokstaver", () => {
    expect(slugifySubjectKey("Kroppsøving")).toBe("kroppsoving");
    expect(slugifySubjectKey("Norsk")).toBe("norsk");
    expect(slugifySubjectKey("Mat og helse")).toBe("mat-og-helse");
  });

  it("trimmer og kollapser whitespace før slugging", () => {
    expect(slugifySubjectKey("  Norsk  ")).toBe("norsk");
    expect(slugifySubjectKey("Kunst   og   håndverk")).toBe("kunst-og-handverk");
  });

  it("tegnsetting blir bindestrek, ledende/avsluttende strippes", () => {
    expect(slugifySubjectKey("K&H")).toBe("k-h");
    expect(slugifySubjectKey("!Matte!")).toBe("matte");
  });

  it("for kort (<2 tegn) eller tom gir null", () => {
    expect(slugifySubjectKey("a")).toBeNull();
    expect(slugifySubjectKey("")).toBeNull();
    expect(slugifySubjectKey("   ")).toBeNull();
  });
});

describe("canonicalizeSubjectFromText", () => {
  it("matcher kjente norske fag via eksakt alias", () => {
    expect(canonicalizeSubjectFromText("Matte")?.subjectKey).toBe("matematikk");
    expect(canonicalizeSubjectFromText("gym")?.subjectKey).toBe("kroppsoving");
    expect(canonicalizeSubjectFromText("Engelsk")?.subjectKey).toBe("engelsk");
    expect(canonicalizeSubjectFromText("KRLE")?.subjectKey).toBe("krle");
  });

  it("er casing-uavhengig og tåler norske bokstaver", () => {
    expect(canonicalizeSubjectFromText("KROPPSØVING")?.subjectKey).toBe("kroppsoving");
    expect(canonicalizeSubjectFromText("kroppsøving")?.subjectKey).toBe("kroppsoving");
  });

  it("returnerer hele det kanoniske objektet (subjectKey + displayName)", () => {
    const hit = canonicalizeSubjectFromText("Matte");
    expect(hit).toEqual({
      subjectKey: "matematikk",
      displayName: "Matematikk",
      aliases: ["matematikk", "matte", "mat", "ma", "mat1p", "mat1t", "matta"],
    });
  });

  it("ukjent/tvetydig fag gir null (bevart konservativ fallback)", () => {
    expect(canonicalizeSubjectFromText("K&H")).toBeNull(); // holdes rå per eksisterende tabell
    expect(canonicalizeSubjectFromText("UTV")).toBeNull();
    expect(canonicalizeSubjectFromText("Blæ")).toBeNull();
  });

  it("null/tom tekst gir null", () => {
    expect(canonicalizeSubjectFromText(null)).toBeNull();
    expect(canonicalizeSubjectFromText("")).toBeNull();
  });
});

describe("canonicalizeSubjectFromStrings", () => {
  it("prøver kildene i rekkefølge og hopper over tomme/null", () => {
    expect(canonicalizeSubjectFromStrings([null, "", "Tysk"])?.subjectKey).toBe("tysk");
    expect(canonicalizeSubjectFromStrings(["Ukjent", "Matte"])?.subjectKey).toBe("matematikk");
  });

  it("returnerer FØRSTE kanoniske treff", () => {
    expect(canonicalizeSubjectFromStrings(["Engelsk", "Matte"])?.subjectKey).toBe("engelsk");
  });

  it("ingen treff gir null", () => {
    expect(canonicalizeSubjectFromStrings([null, undefined, "", "Blæ"])).toBeNull();
  });

  it("muterer ikke input-arrayen", () => {
    const input = ["Ukjent", "Matte"];
    const snapshot = JSON.stringify(input);
    canonicalizeSubjectFromStrings(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("buildCustomSubjectKey", () => {
  it("bygger stabil custom-key med bevart differensiator", () => {
    expect(buildCustomSubjectKey("UTV")).toBe("custom:utv");
    expect(buildCustomSubjectKey("K&H")).toBe("custom:k-h");
    expect(buildCustomSubjectKey("Språk")).toBe("custom:sprak");
  });

  it("tom tekst gir 'custom:ukjent'", () => {
    expect(buildCustomSubjectKey("")).toBe("custom:ukjent");
    expect(buildCustomSubjectKey("!!!")).toBe("custom:ukjent");
  });

  it("bruker det eksporterte prefikset", () => {
    expect(buildCustomSubjectKey("UTV").startsWith(CUSTOM_SUBJECT_PREFIX)).toBe(true);
  });
});

describe("determinisme og tabellintegritet", () => {
  it("samme input gir identisk output (deterministisk)", () => {
    expect(canonicalizeSubjectFromText("Matte")).toEqual(canonicalizeSubjectFromText("Matte"));
    expect(buildCustomSubjectKey("K&H")).toBe(buildCustomSubjectKey("K&H"));
    expect(slugifySubjectKey("Kroppsøving")).toBe(slugifySubjectKey("Kroppsøving"));
  });

  it("CANONICAL_SUBJECTS har unike subjectKeys og forventet dekning", () => {
    const keys = CANONICAL_SUBJECTS.map((s) => s.subjectKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const expected of ["norsk", "matematikk", "engelsk", "kroppsoving", "kunst-og-handverk"]) {
      expect(keys).toContain(expected);
    }
  });
});
