import { getDb } from './db'

// Anthropic tool definitions for Claude tool-use
export const CHAT_TOOLS = [
  {
    name: 'get_campaign_metrics',
    description: 'Haal dagelijkse metrics op voor een campagne (kosten, ROAS, conversies, klikken). Gebruik dit om prestaties te analyseren.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
        period: { type: 'number', description: 'Aantal dagen terug (default 30)', default: 30 },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_keywords',
    description: 'Haal zoekwoorden op voor een campagne met prestatie-metrics (kosten, klikken, conversies, ROAS).',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_search_terms',
    description: 'Haal zoekopdrachten op voor een campagne met kosten en conversies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_ad_texts',
    description: 'Haal huidige advertentieteksten (headlines en descriptions) op voor een campagne.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_products',
    description: 'Haal producten op uit Merchant Center, optioneel gefilterd op land en/of zoekterm. Geeft alle statussen terug (approved, disapproved, pending).',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'Landcode (nl, de, fr, es, it, com). Leeg = alle landen.' },
        search: { type: 'string', description: 'Zoek op producttitel (bevat). Gebruik dit om specifieke producten te vinden.' },
      },
      required: [],
    },
  },
  {
    name: 'get_suggestions',
    description: 'Haal lopende AI suggesties op, optioneel gefilterd op campagne.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne (optioneel)' },
      },
      required: [],
    },
  },
  {
    name: 'propose_action',
    description: 'Stel een concrete actie voor aan de gebruiker. De gebruiker kan deze goedkeuren of afwijzen. Gebruik dit ALLEEN na analyse van de data. Leg altijd uit waarom je deze actie voorstelt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['budget_change', 'bid_adjustment', 'keyword_negative', 'pause_campaign', 'keyword_add', 'ad_text_change', 'new_campaign', 'schedule_change'],
          description: 'Type actie',
        },
        title: { type: 'string', description: 'Korte beschrijving van de actie' },
        details: {
          type: 'object',
          description: 'Actie-specifieke details. budget_change: {campaign_name, old_budget, new_budget}. keyword_negative: {campaign_name, keyword, match_type}. bid_adjustment: {campaign_name, adgroup_name, old_bid, new_bid}. pause_campaign: {campaign_name}. keyword_add: {campaign_name, adgroup_name, keywords[], match_type}. ad_text_change: {campaign_name, adgroup_name, headlines[], descriptions[]}.',
        },
      },
      required: ['type', 'title', 'details'],
    },
  },
]

// Execute a tool call and return the result as a string
export function executeTool(name: string, input: Record<string, unknown>): { result: string; proposedAction?: { type: string; title: string; details: Record<string, unknown> } } {
  const db = getDb()

  switch (name) {
    case 'get_campaign_metrics': {
      const period = (input.period as number) || 30
      const metrics = db.prepare(`
        SELECT date, cost, clicks, impressions, conversions, conversion_value, roas, avg_cpc, ctr
        FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-' || ? || ' days')
        ORDER BY date DESC
      `).all(input.campaign_id, period)
      const totals = db.prepare(`
        SELECT SUM(cost) as cost, SUM(clicks) as clicks, SUM(conversions) as conversions,
          SUM(conversion_value) as value,
          CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
        FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-' || ? || ' days')
      `).get(input.campaign_id, period)
      return { result: JSON.stringify({ totals, daily: metrics }) }
    }

    case 'get_keywords': {
      const keywords = db.prepare(`
        SELECT k.text, k.match_type, k.bid, k.status, ag.name as adgroup,
          SUM(km.cost) as cost, SUM(km.clicks) as clicks,
          SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
          CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas
        FROM keywords k
        JOIN ad_groups ag ON ag.id = k.adgroup_id
        LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-30 days')
        WHERE ag.campaign_id = ?
        GROUP BY k.id ORDER BY cost DESC
      `).all(input.campaign_id)
      return { result: JSON.stringify(keywords) }
    }

    case 'get_search_terms': {
      const terms = db.prepare(`
        SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks,
          SUM(conversions) as conversions, SUM(conversion_value) as value
        FROM search_terms WHERE campaign_id = ? AND date >= date('now', '-30 days')
        GROUP BY search_term ORDER BY cost DESC LIMIT 50
      `).all(input.campaign_id)
      return { result: JSON.stringify(terms) }
    }

    case 'get_ad_texts': {
      const ads = db.prepare(`
        SELECT ag.name as adgroup, a.headlines, a.descriptions, a.status
        FROM ads a
        JOIN ad_groups ag ON ag.id = a.adgroup_id
        WHERE ag.campaign_id = ? AND a.status = 'ENABLED'
        ORDER BY ag.name
      `).all(input.campaign_id)
      return { result: JSON.stringify((ads as any[]).map((a: any) => ({
        adgroup: a.adgroup,
        headlines: JSON.parse(a.headlines || '[]'),
        descriptions: JSON.parse(a.descriptions || '[]'),
      }))) }
    }

    case 'get_products': {
      const country = input.country as string | undefined
      const search = input.search as string | undefined
      const conditions: string[] = []
      const params: (string | number)[] = []
      if (country) {
        conditions.push('LOWER(country) = LOWER(?)')
        params.push(country)
      }
      if (search) {
        conditions.push('LOWER(title) LIKE LOWER(?)')
        params.push(`%${search}%`)
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const products = db.prepare(`SELECT title, price, currency, availability, status, margin_label, country FROM products ${where} ORDER BY title LIMIT 200`).all(...params)
      const total = db.prepare(`SELECT COUNT(*) as count FROM products ${where}`).get(...params) as { count: number }
      return { result: JSON.stringify({ products, total: total.count }) }
    }

    case 'get_suggestions': {
      let suggestions
      if (input.campaign_id) {
        suggestions = db.prepare(`
          SELECT s.id, s.type, s.priority, s.title, s.description, s.details, s.status
          FROM ai_suggestions s
          JOIN ai_analyses a ON a.id = s.analysis_id
          WHERE s.details LIKE '%' || (SELECT name FROM campaigns WHERE id = ?) || '%'
          ORDER BY s.id DESC LIMIT 20
        `).all(input.campaign_id)
      } else {
        suggestions = db.prepare(`
          SELECT id, type, priority, title, description, details, status
          FROM ai_suggestions ORDER BY id DESC LIMIT 20
        `).all()
      }
      return { result: JSON.stringify(suggestions) }
    }

    case 'propose_action': {
      const action = {
        type: input.type as string,
        title: input.title as string,
        details: input.details as Record<string, unknown>,
      }
      return {
        result: `Actie voorgesteld aan gebruiker: ${action.title}`,
        proposedAction: action,
      }
    }

    default:
      return { result: `Onbekende tool: ${name}` }
  }
}
