import { describe, expect, it } from "vitest";
import { djb2Hex } from "@/lib/stable-id";

/**
 * Faste testvektorer for den delte djb2-helperen. De forventede verdiene er FROSNE
 * literaler (ikke beregnet med en kopi av algoritmen i testen), slik at en utilsiktet
 * endring av initialverdi, iterasjon, bitoperasjoner, unsigned-konvertering eller
 * hex-formatering fanges opp. Verdiene låser produksjonens `arrangementStableKey`-hash.
 */
describe("djb2Hex — delt deterministisk stable-id-hash", () => {
  it("tom streng → initialverdien 5381 (0x1505) som 8-sifret hex", () => {
    expect(djb2Hex("")).toBe("00001505");
  });

  it("enkel ASCII-streng", () => {
    expect(djb2Hex("abc")).toBe("0b873285");
  });

  it("norsk tekst med æ/ø/å", () => {
    expect(djb2Hex("blåbærsyltetøy")).toBe("bfc667ba");
  });

  it("semantisk ID-streng med dato, klassekode og klokkeslett", () => {
    expect(djb2Hex("2026-06-18|2STC|10:30")).toBe("45b6cea2");
  });

  it("to nesten identiske strenger gir forskjellige hashes", () => {
    const a = djb2Hex("tg-arr|2STC|2026-06");
    const b = djb2Hex("tg-arr|2STD|2026-06");
    expect(a).toBe("84dd2da1");
    expect(b).toBe("c4798426");
    expect(a).not.toBe(b);
  });

  it("samme input flere ganger gir identisk output (determinisme)", () => {
    const s = "2026-06-18|2STC|10:30";
    expect(djb2Hex(s)).toBe(djb2Hex(s));
    expect(djb2Hex(s)).toBe("45b6cea2");
  });

  it("alltid 8-sifret lowercase hex", () => {
    for (const s of ["", "a", "blåbær", "tg-arr|2STC|2026-06", "x".repeat(500)]) {
      expect(djb2Hex(s)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
