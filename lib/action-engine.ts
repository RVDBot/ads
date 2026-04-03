import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

function errorToString(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    if (Array.isArray(obj.errors)) {
      return obj.errors.map((err: any) => err.message || JSON.stringify(err)).join('; ')
    }
    if (obj.message) return String(obj.message)
    return JSON.stringify(e)
  }
  return String(e)
}

// Resolve Google IDs: customer_id from settings, campaign/adgroup/keyword IDs from DB
function findCampaignByName(db: ReturnType<typeof getDb>, name: string) {
  // Try exact match first
  let camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name = ?').get(name) as any
  if (camp) return camp

  // Try case-insensitive match
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name COLLATE NOCASE = ?').get(name) as any
  if (camp) return camp

  // Try LIKE match (AI might abbreviate or slightly differ)
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name LIKE ?').get(`%${name}%`) as any
  if (camp) return camp

  // Try reverse: campaign name contains the search term, or search term contains campaign name
  const allCamps = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns').all() as any[]
  const nameLower = name.toLowerCase()
  return allCamps.find((c: any) => nameLower.includes(c.name.toLowerCase())) || null
}

function findAdGroupByName(db: ReturnType<typeof getDb>, name: string, googleCampaignId?: string) {
  const params: string[] = [name]
  let sql = 'SELECT google_adgroup_id, name FROM ad_groups WHERE name = ?'
  if (googleCampaignId) {
    sql += ' AND campaign_id = (SELECT id FROM campaigns WHERE google_campaign_id = ?)'
    params.push(googleCampaignId)
  }
  let ag = db.prepare(sql).get(...params) as any
  if (ag) return ag

  // Case-insensitive fallback
  ag = db.prepare(sql.replace('name = ?', 'name COLLATE NOCASE = ?')).get(...params) as any
  if (ag) return ag

  // LIKE fallback
  params[0] = `%${name}%`
  ag = db.prepare(sql.replace('name = ?', 'name LIKE ?')).get(...params) as any
  return ag || null
}

function resolveGoogleIds(db: ReturnType<typeof getDb>, details: any) {
  const customerId = getSetting('google_ads_customer_id')
  if (!customerId) throw new Error('Google Ads customer ID niet geconfigureerd')

  const resolved = { ...details, customer_id: customerId }

  // If campaign_name is given but no google_campaign_id, look it up
  if (details.campaign_name && !details.google_campaign_id) {
    const camp = findCampaignByName(db, details.campaign_name)
    if (camp) {
      resolved.google_campaign_id = camp.google_campaign_id
      if (!resolved.old_budget) resolved.old_budget = camp.daily_budget
      log('info', 'google-ads', `Campagne gevonden: "${camp.name}" voor zoeknaam "${details.campaign_name}"`)
    } else {
      log('warn', 'google-ads', `Campagne niet gevonden voor naam: "${details.campaign_name}"`)
    }
  }

  // If adgroup_name is given but no google_adgroup_id, look it up
  if (details.adgroup_name && !details.google_adgroup_id) {
    const ag = findAdGroupByName(db, details.adgroup_name, resolved.google_campaign_id)
    if (ag) {
      resolved.google_adgroup_id = ag.google_adgroup_id
    } else {
      log('warn', 'google-ads', `Ad group niet gevonden voor naam: "${details.adgroup_name}"`)
    }
  }

  return resolved
}

export async function applySuggestion(suggestionId: number, appliedBy: 'manual' | 'semi_auto' | 'full_auto' = 'manual'): Promise<void> {
  const db = getDb()
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId) as any
  if (!suggestion) throw new Error('Suggestie niet gevonden')
  if (suggestion.status === 'applied') throw new Error('Al toegepast')

  const rawDetails = JSON.parse(suggestion.details)
  const details = resolveGoogleIds(db, rawDetails)

  // Safety checks
  const maxBudgetChange = parseFloat(getSetting('safety_max_budget_change_day') || '50')
  const maxPercentChange = parseFloat(getSetting('safety_max_percent_change') || '25')

  let oldValue: string | null = null
  let newValue: string | null = null
  let googleResponse: unknown = null

  try {
    switch (suggestion.type) {
      case 'budget_change': {
        const budgetDiff = Math.abs((details.new_budget || 0) - (details.old_budget || 0))
        if (budgetDiff > maxBudgetChange) throw new Error(`Budget wijziging €${budgetDiff} overschrijdt limiet €${maxBudgetChange}`)
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor budget wijziging')
        oldValue = `€${details.old_budget}`
        newValue = `€${details.new_budget}`
        googleResponse = await applyBudgetChange(details)
        break
      }
      case 'bid_adjustment': {
        const pctChange = Math.abs(details.percent_change || 0)
        if (pctChange > maxPercentChange) throw new Error(`Wijziging ${pctChange}% overschrijdt limiet ${maxPercentChange}%`)
        oldValue = `€${details.old_bid}`
        newValue = `€${details.new_bid}`
        googleResponse = await applyBidAdjustment(details)
        break
      }
      case 'keyword_negative': {
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor negatief zoekwoord')
        newValue = details.keyword
        googleResponse = await addNegativeKeyword(details)
        break
      }
      case 'pause_campaign': {
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden om te pauzeren')
        oldValue = 'ENABLED'
        newValue = 'PAUSED'
        googleResponse = await pauseCampaign(details)
        break
      }
      case 'keyword_add': {
        newValue = details.keyword || details.keywords?.join(', ')
        googleResponse = await addKeywords(details)
        break
      }
      default: {
        log('warn', 'google-ads', `Onbekend suggestie-type: ${suggestion.type}`, { suggestionId })
        // Still mark as applied for manual-only types
      }
    }
  } catch (e) {
    log('error', 'google-ads', `Suggestie ${suggestionId} toepassen mislukt`, { error: errorToString(e) })
    throw e
  }

  // Record in action log
  db.prepare(`
    INSERT INTO action_log (suggestion_id, action_type, description, old_value, new_value, applied_by, google_response)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(suggestionId, suggestion.type, suggestion.title, oldValue, newValue, appliedBy, JSON.stringify(googleResponse))

  // Mark suggestion as applied
  db.prepare('UPDATE ai_suggestions SET status = ?, applied_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('applied', suggestionId)

  // Record ROAS before (for feedback loop)
  if (details.google_campaign_id) {
    const campaignDbId = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?').get(String(details.google_campaign_id)) as { id: number } | undefined
    if (campaignDbId) {
      const currentRoas = db.prepare(`
        SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
        FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-7 days')
      `).get(campaignDbId.id) as { roas: number } | undefined
      if (currentRoas) {
        db.prepare('UPDATE ai_suggestions SET result_roas_before = ? WHERE id = ?').run(currentRoas.roas, suggestionId)
      }
    }
  }

  log('info', 'google-ads', `Suggestie ${suggestionId} toegepast: ${suggestion.title}`, { type: suggestion.type, appliedBy })
}

// Google Ads API action implementations
// All functions use customer_id from settings (resolved by resolveGoogleIds)
// and google_campaign_id / google_adgroup_id from the DB

async function applyBudgetChange(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()
  // First query the budget resource name for this campaign
  const [campaign] = await customer.query(`
    SELECT campaign.id, campaign_budget.resource_name
    FROM campaign
    WHERE campaign.id = ${details.google_campaign_id}
    LIMIT 1
  `)
  if (!campaign?.campaign_budget?.resource_name) throw new Error(`Budget niet gevonden voor campagne ${details.google_campaign_id}`)
  return customer.mutateResources([{
    entity: 'campaign_budget',
    operation: 'update',
    resource: {
      resource_name: campaign.campaign_budget.resource_name,
      amount_micros: Math.round((details.new_budget || 0) * 1_000_000),
    },
  }])
}

async function applyBidAdjustment(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()
  return customer.mutateResources([{
    entity: 'ad_group_criterion',
    operation: 'update',
    resource: {
      resource_name: `customers/${details.customer_id}/adGroupCriteria/${details.google_adgroup_id}~${details.criterion_id}`,
      cpc_bid_micros: Math.round((details.new_bid || 0) * 1_000_000),
    },
  }])
}

async function addNegativeKeyword(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()
  return customer.mutateResources([{
    entity: 'campaign_criterion',
    operation: 'create',
    resource: {
      campaign: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
      negative: true,
      keyword: { text: details.keyword, match_type: details.match_type || 'EXACT' },
    },
  }])
}

async function pauseCampaign(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()
  return customer.mutateResources([{
    entity: 'campaign',
    operation: 'update',
    resource: {
      resource_name: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
      status: 'PAUSED',
    },
  }])
}

async function addKeywords(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()
  const keywords = Array.isArray(details.keywords) ? details.keywords : [details.keyword]
  return customer.mutateResources(keywords.map((kw: string) => ({
    entity: 'ad_group_criterion' as const,
    operation: 'create' as const,
    resource: {
      ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
      keyword: { text: kw, match_type: details.match_type || 'PHRASE' },
    },
  })))
}

// Auto-apply logic for scheduler
export async function autoApplySuggestions(): Promise<void> {
  const autonomy = getSetting('ai_autonomy_level')
  if (!autonomy || autonomy === 'manual') return

  const db = getDb()
  const pending = db.prepare("SELECT * FROM ai_suggestions WHERE status = 'pending'").all() as any[]

  const semiAutoTypes = ['budget_change', 'bid_adjustment', 'keyword_negative']

  for (const s of pending) {
    const canAutoApply = autonomy === 'full_auto' || (autonomy === 'semi_auto' && semiAutoTypes.includes(s.type))
    if (canAutoApply) {
      try {
        await applySuggestion(s.id, autonomy === 'full_auto' ? 'full_auto' : 'semi_auto')
      } catch (e) {
        log('error', 'google-ads', `Auto-apply mislukt voor suggestie ${s.id}`, { error: errorToString(e) })
      }
    }
  }
}
