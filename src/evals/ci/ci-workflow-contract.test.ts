/**
 * Workflow-kontrakttest for required-checken «school-semantic-quality-gate».
 *
 * Låser den kritiske GitHub Actions-kontrakten i .github/workflows/ci.yml som TEKST
 * (ingen YAML-dependency, ingen generell parser): gate-jobben skal alltid rapportere et
 * eksplisitt resultat — `needs: test-and-build` + `if: always()` + et prerequisite-step som
 * KUN aksepterer resultatet `success` og gir exit 1 ellers (failure/skipped/cancelled).
 * Uten dette blir jobben skipped når test-and-build feiler, og en skipped required check
 * blokkerer ikke merge.
 *
 * Analysen avgrenses til gate-jobbens egen YAML-seksjon for ikke å matche andre jobs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WORKFLOW_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "ci.yml");
const workflowText = readFileSync(WORKFLOW_PATH, "utf8");

/** Gate-jobbens egen seksjon: fra job-nøkkelen til slutten av filen (den er siste jobb). */
function gateJobSection(): string {
  const start = workflowText.indexOf("  school-semantic-quality-gate:");
  expect(start, "gate-jobben finnes i workflowen").toBeGreaterThan(-1);
  return workflowText.slice(start);
}

describe("workflow-kontrakten for school-semantic-quality-gate", () => {
  it("required check-navnet er uendret: jobb-nøkkel og name er school-semantic-quality-gate", () => {
    const section = gateJobSection();
    expect(section).toContain("school-semantic-quality-gate:");
    expect(section).toContain("name: school-semantic-quality-gate");
  });

  it("jobben har needs: test-and-build OG if: always() (aldri skipped ved prerequisite-feil)", () => {
    const section = gateJobSection();
    expect(section).toContain("needs: test-and-build");
    expect(section).toContain("if: ${{ always() }}");
  });

  it("prerequisite-steget ligger FØR checkout og leser needs.test-and-build.result", () => {
    const section = gateJobSection();
    const prerequisiteIndex = section.indexOf("Verify test-and-build prerequisite");
    const checkoutIndex = section.indexOf("actions/checkout@v4");
    expect(prerequisiteIndex).toBeGreaterThan(-1);
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(prerequisiteIndex).toBeLessThan(checkoutIndex);
    expect(section).toContain("${{ needs.test-and-build.result }}");
  });

  it("bare resultatet success aksepteres — alt annet gir exit 1", () => {
    const section = gateJobSection();
    expect(section).toContain('if [ "$TEST_AND_BUILD_RESULT" != "success" ]');
    expect(section).toContain("exit 1");
  });

  it("gate-jobben har fortsatt eksplisitt timeout", () => {
    expect(gateJobSection()).toContain("timeout-minutes: 20");
  });

  it("workflowen har fortsatt permissions: contents: read", () => {
    expect(workflowText).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it("ingen deploy- eller secret-steg er introdusert", () => {
    expect(workflowText).not.toContain("secrets.");
    expect(workflowText.toLowerCase()).not.toContain("deploy");
    expect(workflowText).not.toContain("vercel");
    expect(workflowText).not.toContain("hostinger");
  });
});
