# AI Chat Assistent — Design Spec

## Doel

Een context-aware AI chatinterface toevoegen aan het Ads Optimizer dashboard waarmee de gebruiker vragen kan stellen over campagnes, suggesties kan bespreken, en direct acties kan laten voorstellen door de AI. De chat is overal beschikbaar en krijgt automatisch de relevante context mee (campagne, suggestie, of globaal).

## Kernbeslissingen

- **Combinatie-aanpak**: Chat is overal te openen, context-aware op basis van waar je bent
- **AI adviseert + stelt acties voor**: De AI kan `propose_action` aanroepen met inline "Pas toe" knoppen — nooit direct uitvoeren zonder bevestiging
- **Chatgeschiedenis bewaard per thread**: Eerdere gesprekken terugleesbaar en bruikbaar als context voor vervolggesprekken
- **Desktop: slide-over panel** (rechts, ~400px) / **Mobiel: floating bubble + popup** (~90% scherm)
- **Basiscontext altijd + detail on-demand via tools**: Beperkt tokengebruik, AI haalt zelf data op wanneer nodig

## Architectuur

Drie lagen:

### 1. Frontend — ChatPanel component

Herbruikbaar React component met props: `contextType`, `contextId`, `onClose`.

**Desktop (slide-over):**
- Schuift in van rechts, ~400px breed
- Halftransparante overlay op de rest van de pagina
- Header: titel (campagnenaam / suggestie-titel / "AI Assistent") + sluitknop
- Berichtenlijst met scroll
- Input veld onderin met verzendknop

**Mobiel (floating):**
- Ronde knop rechtsonder met AI-icoon
- Opent chatvenster ~90% van scherm
- Zelfde layout als desktop, full-width

**Berichtweergave:**
- User-berichten: rechts uitgelijnd, accent kleur
- AI-berichten: links uitgelijnd, surface kleur
- Actievoorstellen: kaart binnen AI-bericht met type-badge, beschrijving, "Pas toe" / "Negeer" knoppen
- Toegepaste acties: groene badge "Toegepast"
- Typing indicator: drie pulserende dots tijdens AI-response
- Tool-gebruik indicator: "Zoekwoorden ophalen..." etc.

**Chat openen vanuit:**
- Campagne detailpagina: "Vraag AI" knop in header
- Suggestiekaart: "Bespreek" knop naast "Pas toe" / "Negeer"
- Navigatie: AI-icoon in de nav bar voor globale chat

### 2. Chat API — `/api/chat`

**`POST /api/chat`** — Nieuw bericht sturen

Request:
```json
{
  "thread_id": null,
  "context_type": "campaign",
  "context_id": 123,
  "message": "Kun je Oostenrijk toevoegen als target country?"
}
```

Response: Server-Sent Events (streaming)

Event types:
- `text_delta` — stukje antwoordtekst
- `tool_start` — AI roept een tool aan (naam + parameters)
- `tool_result` — tool klaar
- `proposed_action` — actiekaart data
- `done` — bericht compleet, bevat `thread_id` en `message_id`

Flow:
1. Frontend stuurt bericht
2. API laadt/maakt thread + laadt laatste 20 berichten
3. API bouwt systemprompt met basiscontext
4. Claude wordt aangeroepen met streaming + tools
5. Bij tool-call: API voert tool server-side uit, stuurt resultaat terug naar Claude
6. Bij `propose_action`: slaat actie op in bericht, stuurt event naar frontend
7. Bij stream-einde: slaat user + assistant berichten op in DB

**`POST /api/chat/apply-action`** — Voorgestelde actie toepassen

Request:
```json
{
  "message_id": 456,
  "action_index": 0
}
```

Haalt proposed_action op uit chat_messages, stuurt door naar bestaande action-engine logica.

**`GET /api/chat/threads`** — Lijst van threads (optioneel filter op context_type/context_id)

**`GET /api/chat/threads/[id]`** — Berichten van een thread ophalen

### 3. AI Tools

**Basiscontext (altijd in systemprompt):**
- Campaign-thread: naam, type, status, budget, country, target_countries, ROAS laatste 7d
- Suggestion-thread: volledige suggestie (title, description, details) + campagne basisinfo
- Global-thread: lijst van alle actieve campagnes met naam + ROAS

**Tools die de AI kan aanroepen:**

| Tool | Parameters | Beschrijving |
|------|-----------|--------------|
| `get_campaign_metrics` | campaign_id, period | Dagelijkse metrics (kosten, ROAS, conversies) |
| `get_keywords` | campaign_id | Zoekwoorden met prestaties |
| `get_search_terms` | campaign_id | Zoekopdrachten met kosten/conversies |
| `get_ad_texts` | campaign_id | Huidige headlines + descriptions |
| `get_products` | country? | Producten uit Merchant Center |
| `get_suggestions` | campaign_id? | Lopende AI suggesties |
| `propose_action` | type, details | Stelt actie voor aan gebruiker |

**`propose_action` details:**
- Zelfde actietypes als bestaande suggesties: `budget_change`, `keyword_negative`, `bid_adjustment`, `pause_campaign`, `keyword_add`, `ad_text_change`, `new_campaign`, `schedule_change`
- Bij "Pas toe" wordt bestaande action-engine.ts hergebruikt (zelfde veiligheidschecks, Google Ads API calls)
- Status wordt opgeslagen in `chat_messages.proposed_actions` JSON

**Systemprompt regels:**
- Rol: Google Ads specialist voor Speed Rope Shop (6 domeinen: .com, .nl, .de, .fr, .es, .it)
- Altijd in het Nederlands antwoorden
- Nooit acties voorstellen zonder eerst data op te halen en te analyseren
- Bij `propose_action` altijd uitleggen waarom
- Beschikbare tools kennen en correct gebruiken

## Data & Opslag

Twee nieuwe tabellen:

### `chat_threads`
| Kolom | Type | Beschrijving |
|-------|------|-------------|
| id | INTEGER PK | Auto-increment |
| context_type | TEXT NOT NULL | 'campaign', 'suggestion', 'global' |
| context_id | INTEGER | campaign.id of ai_suggestions.id, NULL bij global |
| title | TEXT | Auto-gegenereerd uit eerste bericht |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |

### `chat_messages`
| Kolom | Type | Beschrijving |
|-------|------|-------------|
| id | INTEGER PK | Auto-increment |
| thread_id | INTEGER NOT NULL | FK naar chat_threads |
| role | TEXT NOT NULL | 'user' of 'assistant' |
| content | TEXT | Berichttekst |
| tool_calls | TEXT | JSON, welke tools de AI aanriep (optioneel) |
| proposed_actions | TEXT | JSON array van voorgestelde acties met status (optioneel) |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |

**Context-koppeling:**
- Campagne detailpagina: zoekt/maakt thread met `context_type='campaign'`, `context_id=campaign.id`
- Suggestiekaart: zoekt/maakt thread met `context_type='suggestion'`, `context_id=suggestion.id`
- Nav bar: `context_type='global'`, `context_id=NULL`

**Chatgeschiedenis naar AI:**
Laatste 20 berichten van de thread worden meegestuurd als conversatie-context. Oudere berichten niet (token-limiet).

## Token tracking

Chat API calls loggen naar bestaande `token_usage` tabel met `call_type='chat'` en het gebruikte model.
