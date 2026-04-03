import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

export async function runAnalysis(): Promise<number> {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')

  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })
  const db = getDb()

  // Gather context
  const campaigns = db.prepare(`
    SELECT c.*,
      SUM(dm.cost) as cost_7d, SUM(dm.conversion_value) as value_7d, SUM(dm.conversions) as conv_7d,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas_7d
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-7 days')
    WHERE c.status = 'ENABLED'
    GROUP BY c.id
  `).all()

  const dailyTrends = db.prepare(`
    SELECT dm.date, c.name, c.country, dm.cost, dm.conversion_value, dm.roas, dm.clicks
    FROM daily_metrics dm JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= date('now', '-14 days')
    ORDER BY dm.date DESC
  `).all()

  const topKeywords = db.prepare(`
    SELECT k.text, k.match_type, ag.name as adgroup, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks, SUM(km.conversions) as conversions, SUM(km.conversion_value) as value
    FROM keywords k
    JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-7 days')
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    GROUP BY k.id ORDER BY cost DESC LIMIT 50
  `).all()

  const wastedTerms = db.prepare(`
    SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks, SUM(conversions) as conversions
    FROM search_terms WHERE date >= date('now', '-7 days')
    GROUP BY search_term HAVING SUM(cost) > 2 AND SUM(conversions) = 0
    ORDER BY cost DESC LIMIT 30
  `).all()

  const products = db.prepare('SELECT * FROM products WHERE status = ? ORDER BY margin_label DESC').all('approved')

  const ga4Pages = db.prepare(`
    SELECT page_path, country, AVG(bounce_rate) as bounce_rate, AVG(avg_session_duration) as duration, SUM(sessions) as sessions
    FROM ga4_pages WHERE date >= date('now', '-7 days')
    GROUP BY page_path, country ORDER BY sessions DESC LIMIT 30
  `).all()

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
      "details": { /* type-specifieke details */ }
    }
  ]
}`

  const userMessage = `## Campagnes (laatste 7 dagen)
${JSON.stringify(campaigns, null, 2)}

## Dagelijkse trends (14 dagen)
${JSON.stringify(dailyTrends, null, 2)}

## Top zoekwoorden (7 dagen)
${JSON.stringify(topKeywords, null, 2)}

## Verspillende zoektermen (kosten zonder conversie)
${JSON.stringify(wastedTerms, null, 2)}

## Producten (Merchant Center)
${JSON.stringify(products.slice(0, 30), null, 2)}

## Landingspagina stats (GA4, 7 dagen)
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

  db.prepare('INSERT INTO token_usage (analysis_id, call_type, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
    .run(analysisId, 'analysis', response.usage.input_tokens, response.usage.output_tokens)

  log('info', 'ai', `Analyse voltooid: ${parsed.suggestions.length} suggesties`, {
    analysisId, findings: parsed.findings.length, suggestions: parsed.suggestions.length, tokens: response.usage
  })

  return analysisId
}
