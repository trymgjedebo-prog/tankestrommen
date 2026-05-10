# Braintrust og Tankestrømmen-eval

## Formål

**Braintrust** brukes til å logge og sammenligne **scoret analyse-output** mot forventninger (fixtures). Det gir sporbarhet på eksperimenter, modeller og feiltyper.

## Scorere (eksempler)

Implementasjonen ligger i `src/evals/tankestrom-scorers.ts` og kan utvides; typiske scorer-navn inkluderer:

- `parentCountCorrect`
- `childCountCorrect`
- `cleanTitlesCritical`
- `titleMatchesExpectedStyle`
- `highlightsCorrect`
- `deadlineCorrect`
- `correctTimePrecision`
- `tentativeCorrect`
- `noDuplicateDays`
- `noEventTitleAsHighlight`
- `noStructureFallbackInNotes`
- `noDeadlineInProgramHighlights`

Aggregeringen **`structureAverage`** oppsummerer hvor godt strukturen matcher forventningene på tvers av scorer-regler.

## Typer tilbakemelding fra scoring

Scorer-laget skiller grovt mellom:

- **Critical failures** — klare brudd (f.eks. feil antall barn, feil presisjon der det er hard forventning)
- **Semantic near misses** — nesten riktig struktur eller innhold der semantisk matching brukes
- **Style warnings** — mindre avvik (f.eks. tittelformat) som ikke nødvendigvis er blokkerende

## Metadata som bør med i Braintrust-runs

For reproduserbarhet og feilanalyse bør eksperiment-metadata gjerne inneholde:

- `fixtureId`
- `model` / forespurt modell-label
- `selectedModel` (faktisk brukt modell der det er relevant)
- `latency` / `latencyMs`
- tokenbruk (`promptTokens`, `completionTokens`, `totalTokens` eller tilsvarende)
- `failures` (liste eller oppsummering)
- `structureAverage` og per-scorer scores der tilgjengelig

## Nøkler og sikkerhet

- **`BRAINTRUST_API_KEY`** kreves for logging til Braintrust i ikke-dry eval.
- **Aldri commit** API-nøkler, tokens eller `.env.local` med hemmeligheter. Bruk miljøvariabler lokalt eller hemmelighåndtering i CI.
