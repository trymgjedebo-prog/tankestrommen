# Agent- og PR-arbeidsflyt

## Grener og main

- **Ikke jobb direkte på `main`.**
- Bruk flyten: **issue → branch → PR → CI → review → merge**.
- **Branch protection** forventes å kreve PR og grønn CI før merge.

## Oppgavestørrelse

- Agentoppgaver bør være **små og avgrensede** først — lettere review og enklere rollback.

## Tankestrømmen-logikk (anbefalt rekkefølge)

1. **Fixture først** — reproducer med tekst/fixture i `fixtures/tankestrom/` og forventning der det hører hjemme.
2. **Test først** — regresjon eller enhetstest som beskriver ønsket oppførsel.
3. **Fix** — minimal endring i pipeline/normalisering.
4. **Eval til slutt** — `dry` og ved behov live mot Braintrust.

## Modell-, prompt- eller analyseendringer

- Kjør **`npm run eval:tankestrom:dry`** som minimum.
- Ved behov: **live eval** og dokumenter **Braintrust-lenke eller eksperimentnavn** i PR-beskrivelsen.

## Cursor / agent skal ikke

- **Hardkode secrets** eller legge API-nøkler i repo.
- **Endre produksjonsmodell** uten eksplisitt oppgave og eval-grunnlag.
- **Refaktorere store deler av pipeline** uten tester som dekker endringen.
- **Pushe direkte til `main`** eller omgå PR/CI der det er påkrevd.

Se `.github/ISSUE_TEMPLATE/agent-task.md` og `.github/pull_request_template.md` for maler som støtter samme disiplin.
