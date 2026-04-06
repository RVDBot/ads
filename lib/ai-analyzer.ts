import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

export async function runAnalysis(period = 14): Promise<number> {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')

  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })
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
      SUM(km.cost) as cost, SUM(km.clicks) as clicks, SUM(km.impressions) as impressions,
      SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
      CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas,
      COUNT(DISTINCT k.id) as keyword_count
    FROM ad_groups ag
    JOIN campaigns c ON c.id = ag.campaign_id
    LEFT JOIN keywords k ON k.adgroup_id = ag.id
    LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-' || ? || ' days')
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

  const previousResults = db.prepare(`
    SELECT type, title, status, result_roas_before, result_roas_after
    FROM ai_suggestions WHERE applied_at IS NOT NULL AND applied_at >= date('now', '-30 days')
    ORDER BY applied_at DESC LIMIT 20
  `).all()

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

## Eerdere suggesties en resultaten (feedback loop)
${previousResults.length > 0 ? JSON.stringify(previousResults, null, 2) : 'Nog geen eerdere suggesties toegepast.'}

Antwoord ALLEEN met een JSON object in dit formaat:
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
- **new_campaign**: { "name": "voorgestelde naam", "country": "nl", "type": "SEARCH|SHOPPING", "daily_budget": 10.0, "keywords": ["kw1"] }
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
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()

  let parsed: { findings: string[]; suggestions: Array<{ type: string; priority: string; title: string; description: string; details: Record<string, unknown> }> }
  try {
    // Try direct parse first
    parsed = JSON.parse(raw)
  } catch {
    try {
      // Strip markdown code fences
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      // Last resort: find first { and last }
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          parsed = JSON.parse(raw.slice(start, end + 1))
        } catch {
          log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
          throw new Error('AI response kon niet geparsed worden')
        }
      } else {
        log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
        throw new Error('AI response kon niet geparsed worden')
      }
    }
  }

  const analysis = db.prepare(`
    INSERT INTO ai_analyses (model, input_tokens, output_tokens, findings, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(model, response.usage.input_tokens, response.usage.output_tokens, JSON.stringify(parsed.findings))

  const analysisId = Number(analysis.lastInsertRowid)

  const stmtSuggestion = db.prepare(`
    INSERT INTO ai_suggestions (analysis_id, type, priority, title, description, details, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `)
  for (const s of parsed.suggestions) {
    stmtSuggestion.run(analysisId, s.type, s.priority, s.title, s.description, JSON.stringify(s.details))
  }

  db.prepare('INSERT INTO token_usage (analysis_id, call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)')
    .run(analysisId, 'analysis', model, response.usage.input_tokens, response.usage.output_tokens)

  log('info', 'ai', `Analyse voltooid: ${parsed.suggestions.length} suggesties`, {
    analysisId, findings: parsed.findings.length, suggestions: parsed.suggestions.length, tokens: response.usage
  })

  return analysisId
}
