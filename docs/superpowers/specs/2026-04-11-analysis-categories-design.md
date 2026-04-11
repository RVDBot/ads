# Drie AI-analyse categorieën: Optimalisatie, Groei, Branding

## Overzicht

De huidige enkele AI-analyse wordt opgesplitst in drie onafhankelijke categorieën, elk met een eigen prompt, dataverzameling en suggestie-types. Op de insights-pagina worden ze als tabs getoond.

## Categorieën

### 1. Optimalisatie (bestaand)

**Doel:** ROAS maximaliseren en verspilling minimaliseren.

**Data:**
- Campagne-prestaties (kosten, conversies, ROAS)
- Dagelijkse trends
- Top zoekwoorden en verspillende zoektermen
- Ad group prestaties
- Advertentieteksten
- Producten met marge-labels
- GA4 landingspagina stats
- Recent toegepaste acties

**Suggestie-types:** `budget_change`, `keyword_negative`, `bid_adjustment`, `pause_campaign`, `ad_text_change`, `keyword_add`, `schedule_change`

Alle types zijn direct toepasbaar via Google Ads API.

### 2. Groei

**Doel:** Meer verkeer en omzet genereren door nieuwe kansen te identificeren.

**Data:**
- Huidige campagnes per land en hun prestaties
- Marktdekking-mapping:
  - NL → Nederland + België (NL-talig)
  - FR → Frankrijk + België (FR-talig)
  - DE → Duitsland + Oostenrijk + Denemarken
  - ES → Spanje
  - IT → Italië
  - COM → NL, BE, LU, DE, AT, DK, FR, ES, IT, UK, NO, CH, SE, GR, FI (Engels)
- Producten met marge-labels
- Bestaande zoekwoorden en prestaties per land
- GA4 analytics per land:
  - Organisch verkeer per land (verkeer zonder ads = bewezen interesse)
  - Bounce rate per land (laag = goed publiek)
  - Conversieratio per land (hoog = bewezen markt)
  - Populaire landingspagina's per land (welke producten trekken interesse)
- Recent toegepaste acties

**Focus van het prompt:**
- Welke landen/markten worden nog niet bediend maar passen bij de marktstructuur?
- Welke goed presterende zoekwoorden/producten in land X bestaan nog niet in land Y?
- Welke product-categorieën hebben nog geen campagne?
- Waar komt al organisch verkeer vandaan zonder ads? (= bewezen kans)
- Nieuwe zoekwoorden op basis van goed converterende search terms

**Suggestie-types:**
- `new_campaign` — direct toepasbaar via API
- `keyword_add` — direct toepasbaar via API
- `market_expansion` — nieuw type, beschrijvend/adviserend, niet direct toepasbaar

### 3. Branding

**Doel:** Merkbekendheid vergroten.

**Data:**
- Branded zoektermen (zoektermen met "speedrope", "speedropeshop" etc.) en prestaties
- Huidige campagne-types (welke kanalen: Search, Shopping, Display, Video)
- Productcatalogus met prijzen en marges
- Marktdekking per land
- Recent toegepaste acties

**Focus van het prompt:**
- Voorstellen voor Display-campagnes (welke markten, welk budget)
- Voorstellen voor YouTube/Video-campagnes
- Branded search campagnes om merknaam te beschermen
- Retargeting-mogelijkheden
- Per voorstel: geschat bereik, aanbevolen budget, doelland

**Suggestie-types:** `brand_campaign`, `display_campaign`, `youtube_campaign` — allemaal beschrijvend/adviserend, niet direct toepasbaar (Display/YouTube vereisen creatieve assets).

## Database

### Wijziging: `ai_suggestions` tabel

Nieuwe kolom `category TEXT NOT NULL DEFAULT 'optimization'` met waarden:
- `optimization`
- `growth`
- `branding`

Bij het opruimen van oude pending suggesties (voor een nieuwe analyse-run) wordt alleen de betreffende category verwijderd:
```sql
DELETE FROM ai_suggestions WHERE status = 'pending' AND category = ?
```

### Wijziging: `ai_analyses` tabel

Nieuwe kolom `category TEXT NOT NULL DEFAULT 'optimization'` om bij te houden welk type analyse is gedraaid.

## Backend: `lib/ai-analyzer.ts`

De bestaande `runAnalysis()` wordt opgesplitst in:

- `runOptimizationAnalysis(period?)` — bestaande logica, grotendeels ongewijzigd
- `runGrowthAnalysis(period?)` — eigen dataverzameling en prompt
- `runBrandingAnalysis(period?)` — eigen dataverzameling en prompt

Elke functie:
1. Verzamelt relevante data
2. Stuurt eigen systeem-prompt met de juiste focus
3. Slaat suggesties op met de juiste `category`
4. Verwijdert alleen pending suggesties van de eigen category

`runAnalysis()` blijft bestaan als wrapper die alle drie aanroept (voor de scheduler).

Een nieuwe `runAnalysisByCategory(category)` functie wordt toegevoegd voor handmatig triggeren van één categorie.

## Frontend: Insights-pagina

### Tabs

Drie tabs bovenaan de pagina: **Optimalisatie** | **Groei** | **Branding**

Elke tab toont:
- Samenvattingsblok met findings van de laatste analyse-run
- Bestaande filters: prioriteit (hoog/medium/laag) en status (in afwachting/toegepast/genegeerd)
- Lijst suggesties gefilterd op `category`
- Eigen "Analyse starten" knop (triggert alleen die categorie)
- Status van laatste analyse (wanneer gedraaid, aantal suggesties)

### Niet-toepasbare suggesties

Suggestie-types `market_expansion`, `brand_campaign`, `display_campaign`, `youtube_campaign` worden getoond zonder "Pas toe" knop. Ze zijn adviserend.

## API

### `POST /api/ai/analyze`

Bestaand endpoint, uitgebreid met optionele `category` parameter:
- Geen category → draai alle drie
- `category=optimization` → alleen optimalisatie
- `category=growth` → alleen groei
- `category=branding` → alleen branding

### `GET /api/ai/suggestions`

Bestaand endpoint, uitgebreid met `category` filter parameter.

## Settings

Eén dropdown `ai_analysis_frequency` blijft, geldt voor alle drie de analyses. Bij automatische run worden alle drie gedraaid.

## Scheduler

Bij automatische sync (dagelijks om 03:00 of na sync) worden alle drie de analyses na elkaar gedraaid, mits `ai_analysis_frequency` niet op `manual` staat.
