import { describe, expect, it } from "vitest";
import { mapOneGradeBandHint } from "./analyze-image";

describe("mapOneGradeBandHint — VGS-klassekoder (Oppgave #1-fiks)", () => {
  it("mapper VGS-klassekoder til vg-trinn (ledende 1/2/3)", () => {
    expect(mapOneGradeBandHint("2STC")).toBe("vg2");
    expect(mapOneGradeBandHint("3STA")).toBe("vg3");
    expect(mapOneGradeBandHint("1IMA")).toBe("vg1");
    expect(mapOneGradeBandHint("2 STC")).toBe("vg2");
    expect(mapOneGradeBandHint("2ST")).toBe("vg2");
  });

  it("beholder eksisterende stier (grunnskole, vg-literal, intervall)", () => {
    expect(mapOneGradeBandHint("10B")).toBe("8-10");
    expect(mapOneGradeBandHint("10. trinn")).toBe("8-10");
    expect(mapOneGradeBandHint("7. trinn")).toBe("5-7");
    expect(mapOneGradeBandHint("2. trinn")).toBe("1-4");
    expect(mapOneGradeBandHint("vg2")).toBe("vg2");
    expect(mapOneGradeBandHint("VG2")).toBe("vg2");
    expect(mapOneGradeBandHint("5-7")).toBe("5-7");
  });

  it("returnerer null for søppel", () => {
    expect(mapOneGradeBandHint("")).toBeNull();
    expect(mapOneGradeBandHint("xyz")).toBeNull();
  });
});
