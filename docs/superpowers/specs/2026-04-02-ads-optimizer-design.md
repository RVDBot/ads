# Ads Optimizer — Design Spec

AI-gestuurd Google Ads dashboard voor SpeedRope Shop. Analyseert campagneprestaties via Claude AI, doet optimalisatiesuggesties, en kan wijzigingen direct doorvoeren via de Google Ads API.

## Doelstelling

Volledig AI-runned Google Ads strategie met zo hoog mogelijke ROAS over 6 markten (.nl, .de, .fr, .es, .it, .com).

## Databronnen

### Google Ads API
- Campagnes: naam, type (Search/Shopping/PMax), status, budget, biedstrategie, targeting (land)
- Dagelijkse metrics: kosten, klikken, impressies, conversies, conversiewaarde, ROAS, CPC, CTR
- Ad groups: zoekwoorden, biedingen, match types
- Advertenties: teksten (headlines, descriptions), prestaties per advertentie
- Search terms report: daadwerkelijke zoekopdrachten, prestaties, negatieve zoekwoorden
- Vereist: Developer Token (standard access), MCC account met één sub-account

### Google Merchant Center API (Content API for Shopping)
- Producten: titel, prijs, beschikbaarheid, marge-label (low/medium/high), product-ID
- Feed status: goedgekeurd, afgekeurd, waarschuwingen
- Prijsvergelijkingen met concurrenten (indien beschikbaar)

### GA4 Data API
- Landingspagina metrics: sessies, bouncepercentage, sessieduur, pagina's per sessie
- Conversie-attributie: assisted conversions, pad-analyse
- Per land/bron segmentatie

### Website Crawl (Shop Profiel)
- Bij eerste setup: crawl alle 6 websites (.nl, .de, .fr, .es, .it, .com)
- Bepaalt: doelgroep, productaanbod, USPs, taal & tone of voice per land
- Wekelijkse hercheck voor wijzigingen
- Resultaat wordt opgeslagen als "Shop Profiel" — basiscontext voor alle AI-analyses
- Bij nieuwe campagne-suggesties: check specifieke landingspagina

## Architectuur

### Scheduled Sync + Lokale DB

Periodieke sync haalt data op uit alle bronnen en slaat het op in SQLite. AI-analyse draait op lokale data. Dashboard laadt instant vanuit de database.

**Sync frequentie** (instelbaar):
- 1x per dag (standaard)
- 4x per dag
- On-demand via "Sync nu" knop

**Rationale:** Google Ads conversiedata is 3-12 uur vertraagd. Realtime polling heeft geen meerwaarde. Dagelijkse sync is de sweet spot.

### Data Flow

```
Google Ads API  ─┐
Merchant Center ─┼─→ Scheduled Sync ─→ SQLite DB ─→ Claude AI ─→ Dashboard UI
GA4 Data API    ─┘                                              ─→ Actie Engine → Google Ads API
```

### Tech Stack

- **Framework:** Next.js 15 App Router + TypeScript + Tailwind CSS v4
- **Database:** SQLite via better-sqlite3 (Node 22)
- **AI:** Anthropic Claude API (@anthropic-ai/sdk)
- **Google Ads:** google-ads-api package (gRPC client voor Google Ads API v18)
- **Google APIs:** googleapis package (Merchant Center Content API, GA4 Data API)
- **Deployment:** Docker (node:22-alpine) → ghcr.io via GitHub Actions → Hostinger VPS
- **Auth:** Wachtwoord-login met scrypt hashing (zelfde patroon als cs-assistant)

## Database Schema

### settings
Sleutel-waarde pairs voor configuratie: API credentials, sync frequentie, AI model, autonomieniveau, veiligheidsgrenzen.

### campaigns
Campagnedata gesynchroniseerd vanuit Google Ads.
- `google_campaign_id`, `name`, `type` (SEARCH/SHOPPING/PERFORMANCE_MAX), `status` (ENABLED/PAUSED), `country` (ISO code), `daily_budget`, `bid_strategy`, `target_roas`

### daily_metrics
Dagelijkse prestatie-snapshots per campagne.
- `campaign_id`, `date`, `cost`, `clicks`, `impressions`, `conversions`, `conversion_value`, `roas`, `avg_cpc`, `ctr`

### ad_groups
Ad groups binnen campagnes.
- `campaign_id`, `google_adgroup_id`, `name`, `status`

### keywords
Zoekwoorden per ad group.
- `adgroup_id`, `google_keyword_id`, `text`, `match_type`, `bid`, `status`

### keyword_metrics
Dagelijkse metrics per zoekwoord.
- `keyword_id`, `date`, `cost`, `clicks`, `impressions`, `conversions`, `conversion_value`

### search_terms
Daadwerkelijke zoekopdrachten uit het search terms report.
- `campaign_id`, `search_term`, `date`, `cost`, `clicks`, `conversions`, `conversion_value`

### ads
Advertenties (responsive search ads).
- `adgroup_id`, `google_ad_id`, `headlines` (JSON array), `descriptions` (JSON array), `status`

### ad_metrics
Dagelijkse metrics per advertentie.
- `ad_id`, `date`, `cost`, `clicks`, `impressions`, `conversions`

### products
Productdata vanuit Merchant Center.
- `merchant_product_id`, `title`, `price`, `currency`, `availability`, `margin_label` (low/medium/high), `country`, `status` (approved/disapproved/pending)

### ga4_pages
Landingspagina-statistieken vanuit GA4.
- `page_path`, `date`, `sessions`, `bounce_rate`, `avg_session_duration`, `pages_per_session`, `country`

### shop_profile
Het door AI gegenereerde profiel per website/land.
- `country`, `profile_content` (markdown), `last_crawled_at`

### ai_analyses
AI-analyse resultaten.
- `id`, `created_at`, `model`, `input_tokens`, `output_tokens`, `findings` (JSON), `status` (pending/applied/dismissed)

### ai_suggestions
Individuele suggesties uit een analyse.
- `analysis_id`, `type` (budget_change/bid_adjustment/keyword_negative/ad_text_change/new_campaign/pause_campaign/keyword_add/schedule_change), `priority` (high/medium/low), `title`, `description`, `details` (JSON — bevat de concrete wijziging), `status` (pending/applied/dismissed/auto_applied), `applied_at`, `result_roas_before`, `result_roas_after`

### action_log
Historie van alle toegepaste wijzigingen.
- `suggestion_id` (nullable), `action_type`, `description`, `old_value`, `new_value`, `applied_by` (manual/semi_auto/full_auto), `created_at`, `google_response` (JSON)

### token_usage
AI tokengebruik per analyse.
- `analysis_id`, `call_type`, `input_tokens`, `output_tokens`, `created_at`

### logs
Technisch logboek voor debugging.
- `id`, `level` (info/warn/error), `category` (sync/ai/google-ads/merchant/ga4/system), `message`, `meta` (JSON — volledige error stacks, request/response details), `created_at`

## AI Analyse Engine

### Input
Claude ontvangt bij elke analyse:
- Shop Profiel (doelgroep, USPs, tone of voice per land)
- Campagneprestaties laatste 7-30 dagen met dag-over-dag trends
- Zoekwoord-prestaties (top performers + verspillers)
- Productdata met marge-labels
- GA4 landingspagina-statistieken
- Eerdere suggesties en hun resultaat (feedback loop — wat werkte wel/niet)

### Output (gestructureerd JSON)
- **Bevindingen:** wat valt op, wat gaat goed/slecht
- **Optimalisaties:** concrete acties met verwacht effect, elk met type en prioriteit
- **Nieuwe campagne-voorstellen:** type, zoekwoorden, doellanden, verwachte ROAS
- **Cross-market analyse:** "deze campagne werkt in .de, probeer .fr"

### Feedback Loop
Na toepassing van een suggestie wordt het ROAS-effect gemeten (voor/na). Bij de volgende analyse krijgt Claude deze resultaten als context, zodat hij leert wat werkt voor SpeedRope Shop.

### Analyse Frequentie (instelbaar)
- Handmatig: alleen bij klik op "Analyseer"
- 1x per dag: automatisch (bijv. 's ochtends na sync)
- Meerdere keren per dag: na elke sync

### Model (instelbaar)
Standaard claude-sonnet-4-6. Instelbaar naar elk beschikbaar Claude model.

## Autonomieniveaus (instelbaar)

### 1. Handmatig (standaard)
Alle suggesties verschijnen in het dashboard met "Pas toe" knoppen. Niets wordt automatisch gewijzigd.

### 2. Semi-autonoom
- **Automatisch:** budget ±20%, biedingsaanpassingen, negatieve zoekwoorden toevoegen
- **Handmatig:** nieuwe campagnes, advertentieteksten, campagnes pauzeren/starten

### 3. Volledig autonoom
Alle suggesties worden automatisch toegepast. Zichtbaar in de Actie Log.

### Veiligheidslimieten (instelbaar)
- Maximale budgetwijziging per dag: standaard €50
- Maximaal % wijziging per keer: standaard 25%
- Campagnes verwijderen: nooit (alleen pauzeren)
- Account-level instellingen: nooit automatisch

## Google Ads API — Ondersteunde Acties

### Budget & Biedingen
- Dagbudget aanpassen
- CPC-biedingen op keyword-niveau
- Biedstrategie wijzigen
- Target ROAS waarde aanpassen

### Campagnebeheer
- Campagne pauzeren / hervatten
- Nieuwe Search campagne aanmaken (zoekwoorden, advertentieteksten, landtargeting)
- Nieuwe Shopping campagne aanmaken (productgroepen, biedingen)
- Ad schedule aanpassen

### Advertenties & Zoekwoorden
- Responsive search ads toevoegen
- Advertenties pauzeren
- Negatieve zoekwoorden toevoegen
- Zoekwoorden toevoegen aan ad groups

### Niet ondersteund
- Campagnes verwijderen (alleen pauzeren)
- Account-level instellingen
- Conversietracking aanpassen
- PMax interne structuur (black box van Google)

## UI Pagina's

### Design Systeem
Ubiquiti-stijl, identiek aan het stock dashboard:
- **Font:** Plus Jakarta Sans
- **Thema:** licht — witte kaarten (#fff) op lichtgrijze achtergrond (#f5f6f8)
- **Navigatie:** frosted glass top bar met tab-stijl links, backdrop-blur
- **Kleuren:** accent blue (#006fff), success green (#0f9960), warning orange (#d97706), danger red (#dc2626)
- **Componenten:** subtiele borders, grote border-radius (16px), schone typografie, skeleton loading, fadeInUp animaties

### Dashboard (hoofdpagina)
- Landenfilter (Alle / per land) + periodefilter (7d / 30d / maand)
- KPI-kaarten: Ad Spend, Omzet, ROAS, Conversies, Gem. CPC — elk met trend vs vorige periode
- ROAS trend grafiek (bar chart per dag)
- Spend per land (horizontale barchart)
- AI Inzichten preview: laatste 3 suggesties met impact-badge en "Pas toe" knop

### Campagnes
- Lijst van alle campagnes met status, type, land, budget, ROAS, kosten
- Klik door naar detail: dagelijkse metrics, trendgrafiek, ad groups, zoekwoorden
- Filter op land, type, status

### Producten
- Productlijst vanuit Merchant Center
- Marge-label, voorraad, prijs, feed status
- Prestaties per product (klikken, conversies, ROAS) via Shopping campagnes

### Zoekwoorden
- Alle zoekwoorden met prestaties
- Search terms report: daadwerkelijke zoekopdrachten
- Negatieve zoekwoorden-suggesties van AI
- Verspillers-overzicht: zoekwoorden met kosten maar zonder conversies

### AI Inzichten
- Volledig overzicht van alle analyses en suggesties
- Filter op prioriteit (hoog/medium/laag), type, status (pending/applied/dismissed)
- Per suggestie: titel, beschrijving, verwacht effect, "Pas toe" / "Negeer" knoppen
- Nieuwe campagne-voorstellen met volledige setup preview
- Feedback resultaten: ROAS voor/na bij toegepaste suggesties

### Actie Log
- Chronologische historie van alle wijzigingen
- Per actie: wat, wanneer, oud → nieuw, door wie (handmatig/semi/auto), AI-redenering
- Resultaat tracking: ROAS effect na toepassing

### Instellingen
- **API Credentials:** Google Ads (developer token, client ID/secret, refresh token, customer ID), Merchant Center ID, GA4 property ID, Anthropic API key
- **Sync:** frequentie instelling (1x/dag, 4x/dag, on-demand)
- **AI:** model selectie, analyse frequentie, autonomieniveau
- **Veiligheid:** maximale budgetwijziging/dag, max % per wijziging
- **Token gebruik:** overzicht van AI-tokenverbruik per dag/week/maand
- **Logboek:** gedetailleerd technisch logboek met filters op level (info/warn/error) en categorie (sync/ai/google-ads/merchant/ga4/system), uitklapbare details met volledige error stacks en metadata

## Deployment

- **Repo:** GitHub (publiek, zelfde als andere projecten)
- **Docker:** node:22-alpine image
- **CI/CD:** GitHub Actions → ghcr.io/rvdbot/ads-optimizer:latest
- **VPS:** Hostinger, docker-compose met volume voor data/ (SQLite + logs)
- **Poort:** 3030:3000 (naast cs-assistant op 3010 en content-dashboard op 3020)

## Google OAuth2 Authenticatie

De Google Ads API, Merchant Center API en GA4 Data API vereisen OAuth2 credentials:
- **Client ID + Client Secret:** via Google Cloud Console project
- **Refresh Token:** eenmalig genereren via OAuth2 consent flow
- **Developer Token:** al beschikbaar (standard access)

De app slaat deze credentials op in de settings tabel. Er is geen in-app OAuth flow nodig — de refresh token wordt eenmalig buiten de app gegenereerd en ingevoerd via de Instellingen pagina.
