# Testing, eval og CI

## Test- og eval-lag

| Kommando | Formål |
|----------|--------|
| `npm test` | Enhets- og integrasjonstester (Vitest) |
| `npm run test:tankestrom-regression` | Regresjon mot faste Tankestrømmen-fixtures via harness |
| `npm run build` | Next.js produksjonsbuild (typer, lint i build) |
| `npm run eval:tankestrom:dry` | Rask eval: harness + scorere, **uten** Braintrust-upload og **uten** live LLM |
| `npm run eval:tankestrom` | Samme fixtures som dry, med **Braintrust**-logging (krever `BRAINTRUST_API_KEY`) |
| `npm run eval:tankestrom:live` | Ekte analyse med **modellkall** + portal-bundle + scoring + Braintrust |

## CI

- CI kjører typisk **test**, **tankestrom-regression** og **build** (se repoets workflow-filer for eksakt liste).
- **Live eval** og kostbare modellkall kjøres **ikke** automatisk i CI per nå.

## Tankestrømmen-fixtures (tekst)

Standard definerte fixture-id-er brukt i eval og regresjon:

- `vaacup_original`
- `hostcup_handball`
- `speiderhelg`
- `turnstevne`

Detaljer om kommandoer og `--fixtures` for live-eval finnes i rot-`README.md` og i `src/evals/tankestrom-fixtures.ts`.
