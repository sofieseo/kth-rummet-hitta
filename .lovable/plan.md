# Förbättra admin-statistiken: tomma sökningar, efterfrågan vs utbud och trender

## Mål
Göra statistikfliken i admin mer användbar för att förstå vad studenterna faktiskt efterfrågar — inte bara vilka knappar de klickar på.

Vi använder **endast befintliga data** i `analytics_events` och `spaces`. Inga nya tabeller eller nya spårningshändelser.

## Vad vi vet redan nu
- 2 369 sidvisningar, 1 270 filterändringar, 69 tomma sökningar finns i databasen.
- Admin-läget hämtar redan hela listan med lokaler, filterkategorier och filteralternativ.
- `AnalyticsTab` hämtar idag bara `analytics_events`; övrig data finns tillgänglig via props.

## Förslag 1: Tomma sökningar med närmaste alternativ

**Idé:** När en filtrering ger noll träffar vill vi se *vad* studenten kan släppa för att få träffar igen.

**Utförande:**
- För varje `empty_results`-händelse visas den aktiva filtreringen (sökord, kategori, ljudnivå, läge etc.).
- Systemet testar att ta bort ett filter i taget och räknar hur många lokaler som då matchar, med hjälp av befintliga `matchesSpace()` och lokal-listan.
- Det bästa alternativet presenteras: ”0 träffar. Om du tar bort *Tyst* visas 12 lokaler.”
- De vanligaste tomma kombinationerna listas med sitt bästa alternativ.

**Varför det är användbart:** Avslöjar om studenterna sätter ihop filter som aldrig kan ge träff — eller om ett enskilt filter är för snävt.

## Förslag 2: Efterfrågan vs utbud per filter

**Idé:** Visa vilka filtervärden som är populära men underrepresenterade i lokalerna.

**Utförande:**
- För varje filtervärde som dyker upp i `filter_change`-händelser räknas:
  - **Efterfrågan:** antal gånger det valts.
  - **Utbudet:** antal lokaler i `spaces` som uppfyller just det värdet.
- Resultatet visas som en tvåraders lista med staplar eller som en tabell, sorterat efter störst skillnad.
- Separata vyer för kategorier (Studieplats/Skapande och paus/Service och faciliteter), ljudnivå, utrustning, faciliteter och läge.

**Varför det är användbart:** Om många söker ”Skrivbordslampa” men få lokaler har det, är det ett tydligt signalvärde för framtida inredning eller uppdatering av filter.

## Förslag 3: Trender över tid

**Idé:** Se hur efterfrågan förändras dag för dag.

**Utförande:**
- Gruppera `filter_change` och `empty_results` efter datum inom vald period.
- Linjediagram med topp-5 eller topp-10 sökord / filtervärden över tid.
- En separat kurva för antal tomma sökningar per dag.
- Exporteras till Excel-bladet "Trender".

**Varför det är användbart:** Gör det möjligt att upptäcka toppar inför tentaperioder eller när vissa filter plötsligt blir populära.

## Tekniskt upplägg

```text
AdminPage
├── redan inläst: spaces, categories, filterOptions
└── AnalyticsTab (utökas med props för spaces/categories/options)
    ├── befintlig query: analytics_events
    ├── ny useMemo: emptyResultsWithAlternatives
    ├── ny useMemo: demandVsSupply
    ├── ny useMemo: trendsOverTime
    └── ny UI: tre nya sektioner + uppdaterad Excel-export
```

### Komponenter/filer som ändras
- `src/components/AnalyticsTab.tsx` – nya beräkningar och nya UI-sektioner.
- `src/lib/analyticsExport.ts` – nya Excel-blad för tomma sökningar, efterfrågan/utbud och trender.
- Eventuellt små justeringar i `src/routes/admin.tsx` för att skicka ner `spaces`, `categories` och `filterOptions` till `AnalyticsTab`.

### Prestanda
- All beräkning sker klient-side på max 50 000 analytics-rader.
- Med cirka 60 lokaler och hundratals filteralternativ är antalet jämförelser litet; inga serverfunktioner eller databasändringar krävs.

## Avgränsningar
- Inga nya spårningshändelser eller tabeller (enligt önskemål).
- Ingen förändring av studentvyn.
- Trender är begränsade till den data som redan loggas (t.ex. sökord och filterval).

## Nästa steg
Om planen godkänns börjar jag med att skicka ner `spaces`, `categories` och `filterOptions` till `AnalyticsTab`, sedan bygga de tre nya analyserna och sist uppdatera Excel-exporten.
