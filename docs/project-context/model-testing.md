# Modelltesting og læring (Steg 7)

## Prinsipp

**Sterkere modell er ikke automatisk bedre** på strukturerte oppgaver som Tankestrømmen. `gpt-5.4-mini` og `gpt-5.4` må **sammenlignes med målinger** (Braintrust / strukturerte scorer), ikke magefølelse.

## Live eval — eksempelkommandoer

Kjør begge modeller mot samme fixture-mengde og sammenlign resultat i Braintrust:

```bash
npm run eval:tankestrom:live -- --model=gpt-5.4-mini --fixtures=all
npm run eval:tankestrom:live -- --model=gpt-5.4 --fixtures=all
```

(Tilpass `--fixtures` om du vil begrense omfanget kostnadsmessig.)

## Hva du bør se på ved modellvalg

- **`structureAverage`** og distribusjon av scorer-feil
- **Critical failures** (ikke bare gjennomsnitt)
- **Latency**
- **Tokenbruk** og estimert **kostnad**
- Stabilitet på **samme fixture** over tid

## Retningslinjer

- **Ikke endre produksjonsmodell** uten dokumentert eval-grunnlag og team-/vedlikeholderavklaring.
- Hvis **begge modeller feiler på samme sted**, undersøk først **pipeline**, **expected JSON** og **scorer-regler** — det er ofte ikke et rent modellproblem.

Se også `braintrust-evals.md` og `testing-evals-and-ci.md`.
