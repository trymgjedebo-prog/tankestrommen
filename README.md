# Tankestrommen

Next.js-app for Tankestrømmen-analyse og relaterte API-er.

## Tankestrømmen-eval

Eval-skriptene måler blant annet struktur, highlights, notater og tidsfelter mot forventninger i `fixtures/tankestrom/expected/*.expected.json`. De endrer ikke analyse-logikk i seg selv; de kjører eksisterende kode og scorere.

### Kommandoer

| Kommando | Beskrivelse |
|----------|-------------|
| `npm run eval:tankestrom:dry` | Kjører alle tekstfixtures gjennom **regresjons-harness** (uten LLM). Ingen Braintrust- eller OpenAI-kall. Rask sjekk lokalt og i CI-lignende miljøer uten nøkler. |
| `npm run eval:tankestrom` | Samme fixtures og scorere som dry, men **logger til Braintrust** når `BRAINTRUST_API_KEY` er satt. Krever ikke OpenAI. |
| `npm run eval:tankestrom:live` | **Live-eval:** kjører faktisk tekstanalyse (OpenAI) + portal-bundle, scorer mot forventninger, logger til Braintrust. Standard fixtures: `vaacup_original` og `hostcup_handball` (se `--fixtures` under). |
| `npm run eval:tankestrom:live:mini` | Som live, med modell `gpt-5.4-mini` (via script-argument). |
| `npm run eval:tankestrom:live:strong` | Som live, med modell `gpt-5.4` (via script-argument). |

### `--fixtures` (kun live-eval)

Live-skriptet støtter valg av fixtures:

- `npm run eval:tankestrom:live -- --fixtures=all` — alle definerte fixtures
- `npm run eval:tankestrom:live -- --fixtures=hostcup_handball`
- `npm run eval:tankestrom:live -- --fixtures=vaacup_original,turnstevne`

Uten `--fixtures` brukes standardlisten (cup-tekster). Gyldige id-er svarer til filene under `fixtures/tankestrom/`, for eksempel: `vaacup_original`, `hostcup_handball`, `speiderhelg`, `turnstevne`.

**Merk:** `eval:tankestrom` og `eval:tankestrom:dry` kjører for øyeblikket alle fixtures som er registrert i koden; de har ikke eget `--fixtures`-flagg.

### Miljøvariabler

| Variabel | Bruk |
|----------|------|
| `BRAINTRUST_API_KEY` | Påkrevd for `eval:tankestrom` (ikke-dry) og for `eval:tankestrom:live*`. |
| `OPENAI_API_KEY` | Påkrevd for `eval:tankestrom:live*` (faktiske modellkall). |

Du kan legge nøkler i `.env.local` i rot av repoet (laster ikke committes). Eksempel på variabler finnes i `.env.example`.

### Viktige merknader

- **Ikke commit API-nøkler** eller annen hemmelig konfigurasjon. Bruk lokale miljøvariabler eller hemmelighåndtering utenfor git.
- **Live-eval koster penger** (OpenAI-forbruk) og bruker Braintrust; kjør bevisst og med egne nøkler.
- **Eval kjøres ikke automatisk i CI** per nå; kjør `npm test`, `npm run test:tankestrom-regression` og `npm run eval:tankestrom:dry` lokalt eller i pipeline når det er ønskelig.

### Relaterte tester

- `npm run test:tankestrom-regression` — Vitest mot regresjons-harness for fixtures.
- `npm test` — full testsuite.
