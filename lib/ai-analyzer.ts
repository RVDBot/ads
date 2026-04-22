import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

// --- Shared types and helpers ---

type AnalysisCategory = 'optimization' | 'growth' | 'branding'

interface ParsedAnalysis {
  findings: string[]
  suggestions: Array<{
    type: string
    priority: string
    title: string
    description: string
    details: Record<string, unknown>
  }>
}

function createClient() {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')
  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  return { client: new Anthropic({ apiKey }), model }
}

function parseAIResponse(raw: string): ParsedAnalysis {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      return JSON.parse(cleaned)
    } catch {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1))
        } catch {
          log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
          throw new Error('AI response kon niet geparsed worden')
        }
      }
      log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
      throw new Error('AI response kon niet geparsed worden')
    }
  }
}

function saveAnalysisResults(
  db: ReturnType<typeof getDb>,
  category: AnalysisCategory,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  parsed: ParsedAnalysis,
): number {
  db.prepare("DELETE FROM ai_suggestions WHERE status = 'pending' AND category = ?").run(category)

  const analysis = db.prepare(`
    INSERT INTO ai_analyses (model, input_tokens, output_tokens, findings, status, category)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(model, usage.input_tokens, usage.output_tokens, JSON.stringify(parsed.findings), category)

  const analysisId = Number(analysis.lastInsertRowid)

  const stmt = db.prepare(`
    INSERT INTO ai_suggestions (analysis_id, type, priority, title, description, details, status, category)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `)
  for (const s of parsed.suggestions) {
    stmt.run(analysisId, s.type, s.priority, s.title, s.description, JSON.stringify(s.details), category)
  }

  db.prepare('INSERT INTO token_usage (analysis_id, call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)')
    .run(analysisId, 'analysis', model, usage.input_tokens, usage.output_tokens)

  log('info', 'ai', `${category} analyse voltooid: ${parsed.suggestions.length} suggesties`, {
    analysisId, category, findings: parsed.findings.length, suggestions: parsed.suggestions.length, tokens: usage,
  })

  return analysisId
}

function getRecentActions(db: ReturnType<typeof getDb>) {
  const previousResults = db.prepare(`
    SELECT type, title, status, details, applied_at, result_roas_before, result_roas_after
    FROM ai_suggestions WHERE applied_at IS NOT NULL AND applied_at >= date('now', '-30 days')
    ORDER BY applied_at DESC LIMIT 20
  `).all() as Array<{ type: string; title: string; status: string; details: string; applied_at: string; result_roas_before: number | null; result_roas_after: number | null }>

  const recentActions = db.prepare(`
    SELECT action_type, description, old_value, new_value, created_at
    FROM action_log WHERE created_at >= date('now', '-14 days')
    ORDER BY created_at DESC LIMIT 30
  `).all()

  const previousForAI = previousResults.map(r => {
    let details: Record<string, unknown> = {}
    try { details = JSON.parse(r.details) } catch {}
    return {
      type: r.type, title: r.title, applied_at: r.applied_at,
      days_ago: Math.round((Date.now() - new Date(r.applied_at).getTime()) / 86400000),
      details, roas_before: r.result_roas_before, roas_after: r.result_roas_after,
    }
  })

  return { previousForAI, recentActions }
}

function recentActionsPrompt(previousForAI: unknown[], recentActions: unknown[]): string {
  return `## Recent toegepaste acties
BELANGRIJK: Onderstaande acties zijn recent uitgevoerd. Houd hier rekening mee:
- Acties van de afgelopen 1-3 dagen hebben nog GEEN effect gehad op de data. Stel NIET dezelfde actie opnieuw voor.
- Gebruik de "days_ago" waarde om in te schatten of een actie al effect kan hebben gehad (minimaal 3-7 dagen nodig).

### Via AI-suggesties toegepast:
${previousForAI.length > 0 ? JSON.stringify(previousForAI, null, 2) : 'Geen.'}

### Via chat/handmatig toegepast:
${recentActions.length > 0 ? JSON.stringify(recentActions, null, 2) : 'Geen.'}`
}

// --- Optimization analysis ---

export async function runOptimizationAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  // Gather context — exclude campaigns inactive for 90+ days
  const campaigns = db.prepare(`
    SELECT c.*,
      SUM(dm.cost) as total_cost, SUM(dm.conversion_value) as total_value, SUM(dm.conversions) as total_conv,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-' || ? || ' days')
    WHERE c.status = 'ENABLED'
      AND EXISTS (SELECT 1 FROM daily_metrics dm2 WHERE dm2.campaign_id = c.id AND dm2.date >= date('now', '-90 days'))
    GROUP BY c.id
  `).all(period)

  const dailyTrends = db.prepare(`
    SELECT dm.date, c.name, c.country, dm.cost, dm.conversion_value, dm.roas, dm.clicks
    FROM daily_metrics dm JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= date('now', '-' || ? || ' days')
    ORDER BY dm.date DESC
  `).all(period)

  const topKeywords = db.prepare(`
    SELECT k.text, k.match_type, ag.name as adgroup, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks, SUM(km.conversions) as conversions, SUM(km.conversion_value) as value
    FROM keywords k
    JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-' || ? || ' days')
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    GROUP BY k.id ORDER BY cost DESC LIMIT 50
  `).all(period)

  const wastedTerms = db.prepare(`
    SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks, SUM(conversions) as conversions
    FROM search_terms WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY search_term HAVING SUM(cost) > 2 AND SUM(conversions) = 0
    ORDER BY cost DESC LIMIT 30
  `).all(period)

  const products = db.prepare('SELECT * FROM products WHERE status = ? ORDER BY margin_label DESC').all('approved')

  // Current ad texts per campaign/adgroup
  const currentAds = db.prepare(`
    SELECT c.name as campaign, ag.name as adgroup, a.headlines, a.descriptions, a.status
    FROM ads a
    JOIN ad_groups ag ON ag.id = a.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    WHERE a.status = 'ENABLED' AND c.status = 'ENABLED'
    ORDER BY c.name, ag.name
  `).all() as Array<{ campaign: string; adgroup: string; headlines: string; descriptions: string; status: string }>

  // Parse JSON headlines/descriptions for readability
  const adsForAI = currentAds.map(a => ({
    campaign: a.campaign,
    adgroup: a.adgroup,
    headlines: JSON.parse(a.headlines || '[]'),
    descriptions: JSON.parse(a.descriptions || '[]'),
  }))

  // Match products to campaigns by keyword overlap in names
  const productsByCampaign: Record<string, Array<{ title: string; price: number | null; margin_label: string | null; country: string | null }>> = {}
  const allProducts = products as Array<{ title: string; price: number | null; margin_label: string | null; country: string | null }>
  const campaignList = campaigns as Array<{ name: string; country: string | null }>
  for (const camp of campaignList) {
    const campWords = camp.name.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 2)
    const matched = allProducts.filter(p => {
      const titleLower = p.title.toLowerCase()
      return campWords.some(w => titleLower.includes(w)) || (camp.country && p.country && p.country.toLowerCase().includes(camp.country.toLowerCase()))
    })
    if (matched.length > 0) {
      productsByCampaign[camp.name] = matched.slice(0, 10).map(p => ({
        title: p.title, price: p.price, margin_label: p.margin_label, country: p.country,
      }))
    }
  }

  // Ad group level performance
  const adGroupPerformance = db.prepare(`
    SELECT ag.name as adgroup, c.name as campaign, c.country, ag.status,
      SUM(am.cost) as cost, SUM(am.clicks) as clicks, SUM(am.impressions) as impressions,
      SUM(am.conversions) as conversions, SUM(am.conversion_value) as value,
      CASE WHEN SUM(am.cost) > 0 THEN SUM(am.conversion_value) / SUM(am.cost) ELSE 0 END as roas,
      (SELECT COUNT(*) FROM keywords k WHERE k.adgroup_id = ag.id) as keyword_count
    FROM ad_groups ag
    JOIN campaigns c ON c.id = ag.campaign_id
    LEFT JOIN adgroup_metrics am ON am.adgroup_id = ag.id AND am.date >= date('now', '-' || ? || ' days')
    WHERE c.status = 'ENABLED'
    GROUP BY ag.id
    HAVING cost > 0
    ORDER BY cost DESC
    LIMIT 50
  `).all(period)

  const ga4Pages = db.prepare(`
    SELECT page_path, country, AVG(bounce_rate) as bounce_rate, AVG(avg_session_duration) as duration, SUM(sessions) as sessions
    FROM ga4_pages WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY page_path, country ORDER BY sessions DESC LIMIT 30
  `).all(period)

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all() as Array<{ country: string; profile_content: string }>

  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een expert Google Ads optimizer voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires actief in 6 landen (NL, DE, FR, ES, IT, internationaal).

${shopProfiles.map(p => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Jouw taak
Analyseer de Google Ads data en geef concrete, actionable suggesties om de ROAS te maximaliseren. Let op:
- Marge-labels van producten (high margin producten verdienen meer budget)
- Cross-market kansen (wat werkt in land X kan ook werken in land Y)
- Zoekwoord-verspilling (kosten zonder conversies)
- Landingspagina-kwaliteit (hoge bounce rate = probleem)
- Trends (dalende ROAS = actie nodig)

## Advertentietekst regels
BELANGRIJK: Bij ad_text_change suggesties:
- Je krijgt de HUIDIGE headlines en descriptions per adgroup. Verbeter deze, niet verzinnen.
- Gebruik ALTIJD de echte productnamen en eigenschappen uit de Merchant Center data en de product-campagne koppelingen.
- Headlines max 30 tekens, descriptions max 90 tekens (Google Ads limieten).
- Schrijf in de taal van het land van de campagne (NL=Nederlands, DE=Duits, FR=Frans, ES=Spaans, IT=Italiaans).
- Verzin NOOIT productkenmerken. Gebruik alleen wat in de productdata staat.

${recentActionsPrompt(previousForAI, recentActions)}
- Als een zoekwoord recent is uitgesloten, stel het NIET opnieuw voor als negatief keyword — het effect is nog niet zichtbaar in de data.
- Als een budget recent is aangepast, stel NIET dezelfde budget wijziging voor.

Antwoord ALLEEN met een JSON object (GEEN markdown code fences, geen toelichting buiten de JSON). Houd findings kort (max 1-2 zinnen per finding) en beperk tot max 10 findings en max 10 suggesties. Formaat:
{
  "findings": ["bevinding 1", "bevinding 2", ...],
  "suggestions": [
    {
      "type": "budget_change|bid_adjustment|keyword_negative|ad_text_change|new_campaign|pause_campaign|keyword_add|schedule_change",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg waarom en verwacht effect",
      "details": { /* type-specifieke details, zie hieronder */ }
    }
  ]
}

## Verplichte details-velden per type
Gebruik ALTIJD de exacte campagne- en ad group namen uit de data hierboven. Het systeem zoekt de Google IDs automatisch op.

- **budget_change**: { "campaign_name": "exacte naam", "old_budget": 10.0, "new_budget": 15.0 }
- **bid_adjustment**: { "campaign_name": "exacte naam", "adgroup_name": "exacte naam", "criterion_id": "keyword criterion id", "old_bid": 0.50, "new_bid": 0.65, "percent_change": 30 }
- **keyword_negative**: { "campaign_name": "exacte naam", "keyword": "zoekterm", "match_type": "EXACT|PHRASE|BROAD" }
- **pause_campaign**: { "campaign_name": "exacte naam" }
- **keyword_add**: { "campaign_name": "exacte naam", "adgroup_name": "exacte naam", "keywords": ["kw1", "kw2"], "match_type": "PHRASE|EXACT|BROAD" }
- **ad_text_change**: { "campaign_name": "exacte naam", "adgroup_name": "exacte naam", "headlines": ["headline1"], "descriptions": ["desc1"] }
- **new_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "type": "SEARCH|SHOPPING", "daily_budget": 10.0, "keywords": ["kw1"], "headlines": ["headline1", "headline2", "headline3"], "descriptions": ["desc1", "desc2"] }
  (SEARCH: verplicht 3+ headlines max 30 tekens, 2+ descriptions max 90 tekens, in de taal van het land. SHOPPING: headlines/descriptions weglaten.)
- **schedule_change**: { "campaign_name": "exacte naam", "schedule": "beschrijving van wijziging" }`

  const userMessage = `## Campagnes (laatste ${period} dagen)
${JSON.stringify(campaigns, null, 2)}

## Dagelijkse trends (${period} dagen)
${JSON.stringify(dailyTrends, null, 2)}

## Top zoekwoorden (${period} dagen)
${JSON.stringify(topKeywords, null, 2)}

## Verspillende zoektermen (kosten zonder conversie, ${period} dagen)
${JSON.stringify(wastedTerms, null, 2)}

## Ad group prestaties (${period} dagen)
${JSON.stringify(adGroupPerformance, null, 2)}

## Huidige advertentieteksten per campagne/adgroup
${JSON.stringify(adsForAI, null, 2)}

## Producten gekoppeld aan campagnes
${Object.keys(productsByCampaign).length > 0 ? JSON.stringify(productsByCampaign, null, 2) : 'Geen product-campagne koppelingen gevonden.'}

## Alle producten (Merchant Center)
${JSON.stringify(allProducts.slice(0, 30).map(p => ({ title: p.title, price: p.price, margin_label: p.margin_label, country: p.country })), null, 2)}

## Landingspagina stats (GA4, ${period} dagen)
${JSON.stringify(ga4Pages, null, 2)}

Analyseer deze data en geef je suggesties als JSON.`

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)

  return saveAnalysisResults(db, 'optimization', model, response.usage, parsed)
}

// --- Placeholder stubs for future analysis categories ---

export async function runGrowthAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  const campaigns = db.prepare(`
    SELECT c.name, c.country, c.type,
      SUM(dm.cost) as total_cost, SUM(dm.conversion_value) as total_value,
      SUM(dm.conversions) as total_conv, SUM(dm.clicks) as total_clicks,
      SUM(dm.impressions) as total_impressions,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-' || ? || ' days')
    WHERE c.status = 'ENABLED'
    GROUP BY c.id
  `).all(period)

  // Keywords performing well — potential for expansion to other markets
  const topConvertingKeywords = db.prepare(`
    SELECT k.text, k.match_type, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks,
      SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
      CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas
    FROM keywords k
    JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-' || ? || ' days')
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    WHERE km.conversions > 0
    GROUP BY k.text, c.country ORDER BY conversions DESC LIMIT 50
  `).all(period)

  // Search terms that convert — candidates for new keywords
  const convertingSearchTerms = db.prepare(`
    SELECT st.search_term, c.name as campaign_name, SUM(st.cost) as cost, SUM(st.clicks) as clicks,
      SUM(st.conversions) as conversions, SUM(st.conversion_value) as value
    FROM search_terms st
    JOIN campaigns c ON c.id = st.campaign_id
    WHERE st.date >= date('now', '-' || ? || ' days') AND st.conversions > 0
    GROUP BY st.search_term ORDER BY conversions DESC LIMIT 30
  `).all(period)

  const products = db.prepare(`
    SELECT title, price, margin_label, country
    FROM products WHERE status = 'approved'
    ORDER BY margin_label DESC
  `).all()

  // GA4 analytics per country — organic traffic reveals untapped markets
  const ga4ByCountry = db.prepare(`
    SELECT country, SUM(sessions) as sessions, AVG(bounce_rate) as bounce_rate,
      AVG(avg_session_duration) as avg_duration
    FROM ga4_pages WHERE date >= date('now', '-' || ? || ' days') AND country IS NOT NULL
    GROUP BY country ORDER BY sessions DESC
  `).all(period)

  // GA4 top pages per country — which products attract organic interest
  const ga4TopPages = db.prepare(`
    SELECT page_path, country, SUM(sessions) as sessions, AVG(bounce_rate) as bounce_rate
    FROM ga4_pages WHERE date >= date('now', '-' || ? || ' days') AND country IS NOT NULL
    GROUP BY page_path, country ORDER BY sessions DESC LIMIT 50
  `).all(period)

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all() as Array<{ country: string; profile_content: string }>
  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een groei-strateeg voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires.

${shopProfiles.map(p => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Marktdekking
SpeedRopeShop is actief in deze markten:
- NL campagnes: bedienen Nederland + België (Nederlandstalig)
- FR campagnes: bedienen Frankrijk + België (Franstalig)
- DE campagnes: bedienen Duitsland + Oostenrijk + Denemarken (Duitstalig)
- ES campagnes: bedienen Spanje
- IT campagnes: bedienen Italië
- COM campagnes (Engels): bedienen NL, BE, LU, DE, AT, DK, FR, ES, IT, UK, NO, CH, SE, GR, FI

## Jouw taak
Analyseer de data en identificeer GROEI-kansen om meer verkeer en omzet te genereren. Focus op:
- Welke landen/markten worden nog niet bediend maar passen bij de marktstructuur?
- Welke goed presterende zoekwoorden/producten in land X bestaan nog niet in land Y?
- Welke product-categorieën hebben nog geen campagne?
- Waar komt al organisch verkeer vandaan zonder ads? (= bewezen kans voor ads)
- Nieuwe zoekwoorden op basis van goed converterende search terms
- High-margin producten die meer exposure verdienen

${recentActionsPrompt(previousForAI, recentActions)}

Antwoord ALLEEN met een JSON object (GEEN markdown code fences). Max 10 findings, max 10 suggesties. Formaat:
{
  "findings": ["bevinding 1", ...],
  "suggestions": [
    {
      "type": "new_campaign|keyword_add|market_expansion",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg waarom en verwacht effect",
      "details": { ... }
    }
  ]
}

## Details-velden per type
- **new_campaign**: { "campaign_name": "naam", "country": "nl", "type": "SEARCH|SHOPPING", "daily_budget": 10.0, "keywords": ["kw1"], "headlines": ["headline1", "headline2", "headline3"], "descriptions": ["desc1", "desc2"] }
  (SEARCH: verplicht 3+ headlines max 30 tekens, 2+ descriptions max 90 tekens, in de taal van het land. SHOPPING: headlines/descriptions weglaten.)
- **keyword_add**: { "campaign_name": "exacte naam", "adgroup_name": "exacte naam", "keywords": ["kw1", "kw2"], "match_type": "PHRASE|EXACT|BROAD" }
- **market_expansion**: { "target_country": "at", "source_country": "de", "rationale": "uitleg", "recommended_budget": 10.0, "recommended_campaign_type": "SEARCH|SHOPPING" }`

  const userMessage = `## Huidige campagnes (laatste ${period} dagen)
${JSON.stringify(campaigns, null, 2)}

## Top converterende zoekwoorden per land (${period} dagen)
${JSON.stringify(topConvertingKeywords, null, 2)}

## Converterende zoektermen (${period} dagen)
${JSON.stringify(convertingSearchTerms, null, 2)}

## Producten (Merchant Center)
${JSON.stringify((products as any[]).slice(0, 40).map(p => ({ title: p.title, price: p.price, margin_label: p.margin_label, country: p.country })), null, 2)}

## Organisch verkeer per land (GA4, ${period} dagen)
${JSON.stringify(ga4ByCountry, null, 2)}

## Top landingspagina's per land (GA4, ${period} dagen)
${JSON.stringify(ga4TopPages, null, 2)}

Identificeer groei-kansen als JSON.`

  const response = await client.messages.create({
    model, max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)
  return saveAnalysisResults(db, 'growth', model, response.usage, parsed)
}

export async function runBrandingAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  // Branded search terms — how is the brand performing?
  const brandedTerms = db.prepare(`
    SELECT st.search_term, c.name as campaign_name, SUM(st.cost) as cost, SUM(st.clicks) as clicks,
      SUM(st.conversions) as conversions, SUM(st.conversion_value) as value
    FROM search_terms st
    JOIN campaigns c ON c.id = st.campaign_id
    WHERE st.date >= date('now', '-' || ? || ' days')
      AND (LOWER(st.search_term) LIKE '%speedrope%' OR LOWER(st.search_term) LIKE '%speed rope%'
           OR LOWER(st.search_term) LIKE '%speedropeshop%')
    GROUP BY st.search_term ORDER BY clicks DESC LIMIT 30
  `).all(period)

  // All campaign types — what channels are already used?
  const campaignTypes = db.prepare(`
    SELECT name, country, type, status,
      SUM(dm.impressions) as impressions, SUM(dm.clicks) as clicks, SUM(dm.cost) as cost
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-' || ? || ' days')
    GROUP BY c.id
  `).all(period)

  const products = db.prepare(`
    SELECT title, price, margin_label, country
    FROM products WHERE status = 'approved'
    ORDER BY margin_label DESC LIMIT 30
  `).all()

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all() as Array<{ country: string; profile_content: string }>
  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een branding-strateeg voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires.

${shopProfiles.map(p => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Marktdekking
- NL: Nederland + België (NL) | FR: Frankrijk + België (FR) | DE: Duitsland + Oostenrijk + Denemarken
- ES: Spanje | IT: Italië | COM (Engels): NL, BE, LU, DE, AT, DK, FR, ES, IT, UK, NO, CH, SE, GR, FI

## Jouw taak
SpeedRopeShop heeft momenteel GEEN branding-campagnes (Display, YouTube, branded search). Analyseer de data en stel voor hoe merkbekendheid vergroot kan worden. Focus op:
- Display-campagnes: welke markten, welk budget, welke doelgroep
- YouTube/Video-campagnes: welke markten, type content (product demos, reviews)
- Branded search: campagnes om de merknaam te beschermen in zoekresultaten
- Retargeting: bezoekers opnieuw bereiken via Display/YouTube
- Per voorstel: aanbevolen budget, doelland, verwacht bereik

${recentActionsPrompt(previousForAI, recentActions)}

Antwoord ALLEEN met een JSON object (GEEN markdown code fences). Max 8 findings, max 8 suggesties. Formaat:
{
  "findings": ["bevinding 1", ...],
  "suggestions": [
    {
      "type": "brand_campaign|display_campaign|youtube_campaign",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg met verwacht bereik en aanbevolen budget",
      "details": { ... }
    }
  ]
}

## Details-velden per type
- **brand_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 5.0, "keywords": ["speedrope shop", "speedropeshop"], "headlines": ["headline1", "headline2", "headline3"], "descriptions": ["desc1", "desc2"], "rationale": "uitleg" }
  (Verplicht 3+ headlines max 30 tekens, 2+ descriptions max 90 tekens, in de taal van het land. Gebruik de merknaam en onderscheidende kenmerken.)
- **display_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 10.0, "target_audience": "beschrijving doelgroep", "rationale": "uitleg" }
- **youtube_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 15.0, "video_concept": "beschrijving video type", "rationale": "uitleg" }`

  const userMessage = `## Branded zoektermen (laatste ${period} dagen)
${JSON.stringify(brandedTerms, null, 2)}

## Alle campagnes en kanalen
${JSON.stringify(campaignTypes, null, 2)}

## Producten (top 30)
${JSON.stringify(products, null, 2)}

Stel branding-strategieën voor als JSON.`

  const response = await client.messages.create({
    model, max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)
  return saveAnalysisResults(db, 'branding', model, response.usage, parsed)
}

// --- Wrapper functions ---

export async function runAnalysisByCategory(category: AnalysisCategory, period = 14): Promise<number> {
  switch (category) {
    case 'optimization': return runOptimizationAnalysis(period)
    case 'growth': return runGrowthAnalysis(period)
    case 'branding': return runBrandingAnalysis(period)
  }
}

export async function runAnalysis(period = 14): Promise<number[]> {
  const results: number[] = []
  for (const cat of ['optimization', 'growth', 'branding'] as AnalysisCategory[]) {
    try {
      results.push(await runAnalysisByCategory(cat, period))
    } catch (e) {
      log('error', 'ai', `${cat} analyse mislukt`, { error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
