# Arkitektur (høyt nivå)

## Analyseflyt

1. **Input** — tekst, PDF eller bilde (med tilhørende routing og ekstraksjon der det trengs).
2. **Modellkall** — språkmodell produserer strukturert analyse (schema/avtalt JSON-lignende output).
3. **Parsing og normalisering** — validering, robusthet mot varianter, dedupe og opprydding.
4. **Cup- og helgeprogram-logikk** — deteksjon av flerdagers arrangementer, betingede dager, kamptider vs. oppmøte, globale ukeplanlinjer som må knyttes til riktig dag.
5. **embeddedSchedule** — barnedager under ett parent-event med metadata for kalender og UI.
6. **Portal bundle** — serialiserbart resultat klart for import eller videre scoring.

## Relevante områder i repoet

| Område | Rolle |
|--------|--------|
| `src/app/api/analyze/` | HTTP-analyse, bygging av forslag og portal-output |
| `src/lib/cup-*` | Cup-/dag-timing, highlights, match-tider, kontekst |
| `src/lib/tankestrom-*` | Regresjons-harness, fixture-runner, portal→regression-mapping |
| `src/evals/` | Scorers, forventninger, fixtures-definisjoner, live-runner |
| `fixtures/tankestrom/` | Tekstfixtures og `expected/*.expected.json` for eval |

## Skill mellom lag

Hold disse adskilt i hodet og i feilsøking:

| Lag | Beskrivelse |
|-----|-------------|
| **Modell-output** | Rå eller semi-strukturert svar fra LLM |
| **Pipeline / normalisering** | Fast kode som retter, merger, klassifiserer og bygger strukturer |
| **Regression bundle** | Deterministisk eller harness-basert representasjon brukt i tester og dry-eval |
| **Braintrust scoring** | Måling mot forventninger; kan kjøres på harness eller live-output |
| **Foreldre-app rendering** | Klient som viser importerte data — ikke del av dette repoets kjernelogikk |

Feil som gjentar seg på **flere modeller** peker ofte mot pipeline, forventninger eller scorer — ikke primært modellvalg.
