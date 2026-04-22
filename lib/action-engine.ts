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
      case 'brand_campaign': {
        // Brand campaign is a Search campaign with branded keywords
        details.type = 'SEARCH'
        newValue = details.campaign_name || null
        googleResponse = await createNewCampaign(details)
        break
      }
      case 'new_campaign': {
        newValue = details.campaign_name || null
        googleResponse = await createNewCampaign(details)
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

async function createNewCampaign(details: any) {
  const { getGoogleAdsClient } = await import('./google-ads')
  const customer = getGoogleAdsClient()

  const campaignName = details.campaign_name || details.name
  if (!campaignName) throw new Error('Campagnenaam ontbreekt in actie details')
  const budgetName = `Budget - ${campaignName} ${Date.now()}`

  // Check for existing budget from a previous failed attempt
  const existingBudgets = await customer.query(`
    SELECT campaign_budget.resource_name
    FROM campaign_budget
    WHERE campaign_budget.name LIKE 'Budget - ${campaignName.replace(/'/g, "\\'")}%'
    ORDER BY campaign_budget.id DESC
    LIMIT 1
  `)
  let budgetResourceName = (existingBudgets[0] as any)?.campaign_budget?.resource_name

  if (!budgetResourceName) {
    await customer.mutateResources([{
      entity: 'campaign_budget' as const,
      operation: 'create' as const,
      resource: {
        name: budgetName,
        amount_micros: Math.round(Number(details.daily_budget || 10) * 1_000_000),
        delivery_method: 'STANDARD',
      },
    }])
    const budgets = await customer.query(`
      SELECT campaign_budget.resource_name
      FROM campaign_budget
      WHERE campaign_budget.name = '${budgetName.replace(/'/g, "\\'")}'
      LIMIT 1
    `)
    budgetResourceName = (budgets[0] as any)?.campaign_budget?.resource_name
  }

  if (!budgetResourceName) throw new Error('Budget aanmaken mislukt — kon resource_name niet vinden')

  const channelType = (details.type as string) || 'SEARCH'
  const isShopping = channelType === 'SHOPPING'
  const campaignResource: Record<string, unknown> = {
    name: campaignName,
    advertising_channel_type: channelType,
    status: 'ENABLED',
    campaign_budget: budgetResourceName,
    contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  }

  if (!isShopping) {
    campaignResource.network_settings = {
      target_google_search: true,
      target_search_network: true,
      target_content_network: false,
    }
    campaignResource.manual_cpc = { enhanced_cpc_enabled: false }
  }

  if (isShopping) {
    const country = ((details.country as string) || 'nl').toLowerCase()
    const merchantId = getSetting(`merchant_center_id_${country}`) || getSetting('merchant_center_id')
    if (!merchantId) throw new Error(`Geen Merchant Center ID gevonden voor land: ${country}`)
    campaignResource.shopping_setting = {
      merchant_id: Number(merchantId),
      sales_country: country.toUpperCase(),
      campaign_priority: Number(details.priority ?? 0),
    }
    campaignResource.manual_cpc = { enhanced_cpc_enabled: false }
  }

  const campaignResult = await customer.mutateResources([{
    entity: 'campaign' as const,
    operation: 'create' as const,
    resource: campaignResource,
  }])

  if (!isShopping) {
    await createSearchCampaignContent(customer, details, campaignName)
  }

  return campaignResult
}

function getShopUrl(country: string): string {
  const urls: Record<string, string> = {
    nl: 'https://speedropeshop.nl',
    de: 'https://speedropeshop.de',
    fr: 'https://speedropeshop.fr',
    es: 'https://speedropeshop.es',
    it: 'https://speedropeshop.it',
  }
  return urls[(country || '').toLowerCase()] || 'https://speedropeshop.com'
}

async function createSearchCampaignContent(customer: any, details: any, campaignName: string) {
  try {
    const escapedName = campaignName.replace(/'/g, "\\'")
    const createdCampaigns = await customer.query(`
      SELECT campaign.resource_name
      FROM campaign
      WHERE campaign.name = '${escapedName}'
      AND campaign.status != 'REMOVED'
      ORDER BY campaign.id DESC
      LIMIT 1
    `)
    const campaignResourceName = (createdCampaigns[0] as any)?.campaign?.resource_name
    if (!campaignResourceName) {
      log('warn', 'google-ads', `Ad group aanmaken overgeslagen: campagne resource_name niet gevonden voor "${campaignName}"`)
      return
    }

    // Ad group aanmaken
    const adGroupName = 'Hoofdgroep'
    await customer.mutateResources([{
      entity: 'ad_group' as const,
      operation: 'create' as const,
      resource: {
        name: adGroupName,
        campaign: campaignResourceName,
        status: 'ENABLED',
      },
    }])

    const createdAdGroups = await customer.query(`
      SELECT ad_group.resource_name
      FROM ad_group
      WHERE ad_group.campaign = '${campaignResourceName}'
      AND ad_group.name = '${adGroupName}'
      AND ad_group.status != 'REMOVED'
      LIMIT 1
    `)
    const adGroupResourceName = (createdAdGroups[0] as any)?.ad_group?.resource_name
    if (!adGroupResourceName) {
      log('warn', 'google-ads', `Keywords aanmaken overgeslagen: ad group resource_name niet gevonden voor "${campaignName}"`)
      return
    }

    // Keywords toevoegen
    const keywords: string[] = Array.isArray(details.keywords) ? details.keywords : []
    if (keywords.length > 0) {
      await customer.mutateResources(keywords.map((kw: string) => ({
        entity: 'ad_group_criterion' as const,
        operation: 'create' as const,
        resource: {
          ad_group: adGroupResourceName,
          keyword: { text: kw, match_type: 'PHRASE' },
          status: 'ENABLED',
        },
      })))
      log('info', 'google-ads', `${keywords.length} keywords toegevoegd aan "${campaignName}"`)
    }

    // RSA aanmaken als headlines/descriptions beschikbaar zijn
    const headlines: string[] = Array.isArray(details.headlines) ? details.headlines : []
    const descriptions: string[] = Array.isArray(details.descriptions) ? details.descriptions : []

    if (headlines.length >= 3 && descriptions.length >= 2) {
      const finalUrl = getShopUrl(details.country)
      await customer.mutateResources([{
        entity: 'ad_group_ad' as const,
        operation: 'create' as const,
        resource: {
          ad_group: adGroupResourceName,
          status: 'ENABLED',
          ad: {
            final_urls: [finalUrl],
            responsive_search_ad: {
              headlines: headlines.map((text: string) => ({ text })),
              descriptions: descriptions.map((text: string) => ({ text })),
            },
          },
        },
      }])
      log('info', 'google-ads', `RSA aangemaakt voor campagne "${campaignName}" met final URL ${finalUrl}`)
    } else {
      log('warn', 'google-ads', `RSA overgeslagen voor "${campaignName}": onvoldoende headlines (${headlines.length}) of descriptions (${descriptions.length}) in suggestie`)
    }
  } catch (e) {
    log('error', 'google-ads', `Ad group/keywords/RSA aanmaken mislukt voor "${campaignName}"`, { error: errorToString(e) })
  }
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
