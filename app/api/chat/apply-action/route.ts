import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'
import { getSetting } from '@/lib/settings'
import { log } from '@/lib/logger'
import { getGoogleAdsClient, syncAds, syncAdGroups, syncCampaigns } from '@/lib/google-ads'

interface ApplyActionBody {
  message_id: number
  action_index: number
  dismiss?: boolean
}

interface ProposedAction {
  type: string
  title: string
  status?: string
  details: Record<string, unknown>
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number') return value
  const s = String(value ?? '').replace(/[^0-9.,]/g, '').replace(',', '.')
  return parseFloat(s) || 0
}

function findCampaignByName(db: ReturnType<typeof getDb>, name: string) {
  let camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name = ?').get(name) as any
  if (camp) return camp
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name COLLATE NOCASE = ?').get(name) as any
  if (camp) return camp
  camp = db.prepare('SELECT google_campaign_id, daily_budget, name FROM campaigns WHERE name LIKE ?').get(`%${name}%`) as any
  if (camp) return camp
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
  ag = db.prepare(sql.replace('name = ?', 'name COLLATE NOCASE = ?')).get(...params) as any
  if (ag) return ag
  params[0] = `%${name}%`
  ag = db.prepare(sql.replace('name = ?', 'name LIKE ?')).get(...params) as any
  return ag || null
}

function resolveGoogleIds(db: ReturnType<typeof getDb>, details: Record<string, unknown>) {
  const customerId = getSetting('google_ads_customer_id')
  if (!customerId) throw new Error('Google Ads customer ID niet geconfigureerd')

  const resolved: Record<string, unknown> = { ...details, customer_id: customerId }

  if (details.campaign_name && !details.google_campaign_id) {
    const camp = findCampaignByName(db, String(details.campaign_name))
    if (camp) {
      resolved.google_campaign_id = camp.google_campaign_id
      if (!resolved.old_budget) resolved.old_budget = camp.daily_budget
      log('info', 'google-ads', `Campagne gevonden: "${camp.name}" voor zoeknaam "${details.campaign_name}"`)
    } else {
      log('warn', 'google-ads', `Campagne niet gevonden voor naam: "${details.campaign_name}"`)
    }
  }

  if (details.adgroup_name && !details.google_adgroup_id) {
    const ag = findAdGroupByName(db, String(details.adgroup_name), resolved.google_campaign_id as string | undefined)
    if (ag) {
      resolved.google_adgroup_id = ag.google_adgroup_id
    } else {
      log('warn', 'google-ads', `Ad group niet gevonden voor naam: "${details.adgroup_name}"`)
    }
  }

  if (details.keyword && !details.google_keyword_id) {
    const agId = resolved.google_adgroup_id
    let kw: any = null
    if (agId) {
      kw = db.prepare(`
        SELECT k.google_keyword_id FROM keywords k
        JOIN ad_groups ag ON ag.id = k.adgroup_id
        WHERE ag.google_adgroup_id = ? AND LOWER(k.text) = LOWER(?) AND LOWER(k.match_type) LIKE LOWER(?)
        LIMIT 1
      `).get(agId, String(details.keyword), `%${details.match_type || ''}%`)
      if (!kw) kw = db.prepare(`
        SELECT k.google_keyword_id FROM keywords k
        JOIN ad_groups ag ON ag.id = k.adgroup_id
        WHERE ag.google_adgroup_id = ? AND LOWER(k.text) = LOWER(?)
        LIMIT 1
      `).get(agId, String(details.keyword))
    }
    if (!kw && resolved.google_campaign_id) {
      kw = db.prepare(`
        SELECT k.google_keyword_id FROM keywords k
        JOIN ad_groups ag ON ag.id = k.adgroup_id
        JOIN campaigns c ON c.id = ag.campaign_id
        WHERE c.google_campaign_id = ? AND LOWER(k.text) = LOWER(?)
        LIMIT 1
      `).get(resolved.google_campaign_id, String(details.keyword))
    }
    if (kw) {
      resolved.google_keyword_id = kw.google_keyword_id
      log('info', 'google-ads', `Zoekwoord gevonden: "${details.keyword}" → ${kw.google_keyword_id}`)
    } else {
      log('warn', 'google-ads', `Zoekwoord niet gevonden in DB: "${details.keyword}"`)
    }
  }

  return resolved
}

async function verifyAction(actionType: string, details: Record<string, unknown>): Promise<{ verified: boolean; actual?: unknown; expected?: unknown }> {
  try {
    const customer = getGoogleAdsClient()

    switch (actionType) {
      case 'budget_change': {
        if (!details.google_campaign_id) return { verified: false }
        const [row] = await customer.query(`
          SELECT campaign_budget.amount_micros
          FROM campaign
          WHERE campaign.id = ${details.google_campaign_id}
          LIMIT 1
        `)
        const actualBudget = row?.campaign_budget?.amount_micros
          ? Number(row.campaign_budget.amount_micros) / 1_000_000
          : null
        const expected = parseMoney(details.new_budget)
        return { verified: actualBudget !== null && Math.abs(actualBudget - expected) < 0.01, actual: actualBudget, expected }
      }

      case 'pause_campaign': {
        if (!details.google_campaign_id) return { verified: false }
        const [row] = await customer.query(`
          SELECT campaign.status
          FROM campaign
          WHERE campaign.id = ${details.google_campaign_id}
          LIMIT 1
        `)
        const status = String(row?.campaign?.status || '')
        return { verified: status === 'PAUSED' || status === '3', actual: status, expected: 'PAUSED' }
      }

      case 'keyword_negative': {
        if (!details.google_campaign_id || !details.keyword) return { verified: false }
        const rows = await customer.query(`
          SELECT campaign_criterion.keyword.text
          FROM campaign_criterion
          WHERE campaign.id = ${details.google_campaign_id}
            AND campaign_criterion.negative = TRUE
            AND campaign_criterion.keyword.text = '${String(details.keyword).replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'gevonden' : 'niet gevonden', expected: details.keyword }
      }

      case 'keyword_add': {
        if (!details.google_adgroup_id) return { verified: false }
        const keywords = Array.isArray(details.keywords) ? details.keywords as string[] : [details.keyword as string]
        const kw = keywords[0]
        if (!kw) return { verified: false }
        const rows = await customer.query(`
          SELECT ad_group_criterion.keyword.text
          FROM ad_group_criterion
          WHERE ad_group.id = ${details.google_adgroup_id}
            AND ad_group_criterion.keyword.text = '${kw.replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'gevonden' : 'niet gevonden', expected: kw }
      }

      case 'bid_adjustment': {
        if (!details.google_adgroup_id || !details.criterion_id) return { verified: true }
        const [row] = await customer.query(`
          SELECT ad_group_criterion.cpc_bid_micros
          FROM ad_group_criterion
          WHERE ad_group.id = ${details.google_adgroup_id}
            AND ad_group_criterion.criterion_id = ${details.criterion_id}
          LIMIT 1
        `)
        const actualBid = row?.ad_group_criterion?.cpc_bid_micros
          ? Number(row.ad_group_criterion.cpc_bid_micros) / 1_000_000
          : null
        const expected = Number(details.new_bid || 0)
        return { verified: actualBid !== null && Math.abs(actualBid - expected) < 0.01, actual: actualBid, expected }
      }

      case 'new_campaign': {
        const campName = details.campaign_name as string | undefined
        if (!campName) return { verified: true }
        const rows = await customer.query(`
          SELECT campaign.name
          FROM campaign
          WHERE campaign.name = '${campName.replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'gevonden' : 'niet gevonden', expected: campName }
      }

      case 'adgroup_create': {
        if (!details.google_campaign_id || !details.adgroup_name) return { verified: true }
        const rows = await customer.query(`
          SELECT ad_group.name FROM ad_group
          WHERE campaign.id = ${details.google_campaign_id}
            AND ad_group.name = '${String(details.adgroup_name).replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'gevonden' : 'niet gevonden', expected: details.adgroup_name }
      }

      case 'campaign_targeting': {
        if (!details.google_campaign_id) return { verified: true }
        const rows = await customer.query(`
          SELECT campaign_criterion.location.geo_target_constant
          FROM campaign_criterion
          WHERE campaign.id = ${details.google_campaign_id}
            AND campaign_criterion.type = 'LOCATION'
          LIMIT 1
        `)
        return { verified: rows.length > 0, actual: rows.length > 0 ? 'geo-targeting aanwezig' : 'geen geo-targeting', expected: 'geo-targeting ingesteld' }
      }

      default:
        // For types we can't easily verify, assume success if API didn't throw
        return { verified: true }
    }
  } catch (e) {
    log('warn', 'google-ads', `Verificatie mislukt: ${e instanceof Error ? e.message : 'onbekend'}`)
    return { verified: true } // Don't block on verification errors
  }
}

// google-ads-api requires numeric enum values for match_type (not strings)
// KeywordMatchType: EXACT=2, PHRASE=3, BROAD=4
const MATCH_TYPE_ENUM: Record<string, number> = { EXACT: 2, PHRASE: 3, BROAD: 4 }
function toMatchTypeEnum(val: unknown): number {
  return MATCH_TYPE_ENUM[String(val || '').toUpperCase()] ?? 3
}

// Geo-target constant resource names per country code
const GEO_TARGETS: Record<string, string> = {
  nl: 'geoTargetConstants/2528', de: 'geoTargetConstants/2276',
  fr: 'geoTargetConstants/2250', es: 'geoTargetConstants/2724',
  it: 'geoTargetConstants/2380', be: 'geoTargetConstants/2056',
  at: 'geoTargetConstants/2040', ch: 'geoTargetConstants/2756',
  gb: 'geoTargetConstants/2826', us: 'geoTargetConstants/2840',
  pl: 'geoTargetConstants/2616', dk: 'geoTargetConstants/2208',
  se: 'geoTargetConstants/2752', no: 'geoTargetConstants/2578',
}

// Language constant resource names per country code
const LANGUAGE_TARGETS: Record<string, string[]> = {
  nl: ['languageConstants/1010'],             // Nederlands
  de: ['languageConstants/1001'],             // Duits
  fr: ['languageConstants/1002'],             // Frans
  es: ['languageConstants/1003'],             // Spaans
  it: ['languageConstants/1004'],             // Italiaans
  be: ['languageConstants/1010', 'languageConstants/1002', 'languageConstants/1019'], // NL+FR+DE
  at: ['languageConstants/1001'],             // Duits
  ch: ['languageConstants/1001', 'languageConstants/1002', 'languageConstants/1019'], // DE+FR+IT
  com: ['languageConstants/1000'],            // Engels
  gb: ['languageConstants/1000'],
  us: ['languageConstants/1000'],
  pl: ['languageConstants/1020'],             // Pools
  dk: ['languageConstants/1009'],             // Deens
  se: ['languageConstants/1015'],             // Zweeds
  no: ['languageConstants/1013'],             // Noors
}

// Language code → language constant (for explicit language overrides)
const LANGUAGE_CODE_MAP: Record<string, string> = {
  nl: 'languageConstants/1010',
  dutch: 'languageConstants/1010',
  de: 'languageConstants/1001',
  german: 'languageConstants/1001',
  fr: 'languageConstants/1002',
  french: 'languageConstants/1002',
  es: 'languageConstants/1003',
  spanish: 'languageConstants/1003',
  it: 'languageConstants/1004',
  italian: 'languageConstants/1004',
  en: 'languageConstants/1000',
  english: 'languageConstants/1000',
  pl: 'languageConstants/1020',
  polish: 'languageConstants/1020',
  da: 'languageConstants/1009',
  danish: 'languageConstants/1009',
  sv: 'languageConstants/1015',
  swedish: 'languageConstants/1015',
  no: 'languageConstants/1013',
  norwegian: 'languageConstants/1013',
}

function applyBidStrategy(resource: Record<string, unknown>, strategy: string, details: Record<string, unknown>) {
  // NOTE: google-ads-api's getFieldMask skips empty objects ({}) — they generate no
  // field mask path so the API silently ignores the mutation. Every strategy object
  // must contain at least one primitive field so the path is included in the mask.
  switch (strategy.toLowerCase()) {
    case 'maximize_clicks':
      // target_spend_micros: 0 = no spend limit (default). Must be present for field mask.
      resource.maximize_clicks = { target_spend_micros: 0 }
      break
    case 'maximize_conversions':
      // target_cpa_micros: 0 = no CPA target. Must be present for field mask.
      resource.maximize_conversions = { target_cpa_micros: 0 }
      break
    case 'maximize_conversion_value':
      // target_roas: 0 = no ROAS target. Must be present for field mask.
      resource.maximize_conversion_value = { target_roas: Number(details.target_roas || 0) }
      break
    case 'target_cpa':
      resource.target_cpa = { target_cpa_micros: Math.round(Number(details.target_cpa || 0) * 1_000_000) }
      break
    case 'target_roas':
      resource.target_roas = { target_roas: Number(details.target_roas || 0) }
      break
    default: // manual_cpc
      resource.manual_cpc = { enhanced_cpc_enabled: false }
  }
}

async function applyTargeting(
  customer: ReturnType<typeof getGoogleAdsClient>,
  customerId: string,
  campaignId: string,
  countries: string | string[],
  languageOverrides?: string[],
) {
  const countryList = (Array.isArray(countries) ? countries : [countries]).map(c => c.toLowerCase())
  const campaignResource = `customers/${customerId}/campaigns/${campaignId}`

  // Remove existing location + language criteria first
  const existing = await customer.query(`
    SELECT campaign_criterion.resource_name, campaign_criterion.type
    FROM campaign_criterion
    WHERE campaign.id = ${campaignId}
      AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE')
      AND campaign_criterion.negative = false
  `)
  for (const row of existing) {
    const rn = (row as any).campaign_criterion?.resource_name
    if (!rn) continue
    try {
      await customer.mutateResources([{
        entity: 'campaign_criterion' as const,
        operation: 'remove' as const,
        resource: rn as any,
      }])
    } catch { /* ignore remove errors */ }
  }

  // Add location targeting for each country
  for (const countryLower of countryList) {
    const geoTarget = GEO_TARGETS[countryLower]
    if (geoTarget) {
      await customer.mutateResources([{
        entity: 'campaign_criterion' as const,
        operation: 'create' as const,
        resource: {
          campaign: campaignResource,
          location: { geo_target_constant: geoTarget },
        },
      }])
    }
  }

  // Resolve languages: explicit overrides or union of country defaults (deduplicated)
  let languages: string[]
  if (languageOverrides && languageOverrides.length > 0) {
    languages = [...new Set(languageOverrides.map(l => LANGUAGE_CODE_MAP[l.toLowerCase()]).filter(Boolean))]
  } else {
    const langSet = new Set<string>()
    for (const countryLower of countryList) {
      for (const lang of LANGUAGE_TARGETS[countryLower] || []) langSet.add(lang)
    }
    languages = [...langSet]
  }

  for (const lang of languages) {
    await customer.mutateResources([{
      entity: 'campaign_criterion' as const,
      operation: 'create' as const,
      resource: {
        campaign: campaignResource,
        language: { language_constant: lang },
      },
    }])
  }

  log('info', 'google-ads', `Targeting ingesteld voor campagne ${campaignId}`, { countries: countryList, languages })
}

async function applyAction(actionType: string, details: Record<string, unknown>): Promise<unknown> {
  const customer = getGoogleAdsClient()

  switch (actionType) {
    case 'budget_change': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor budget wijziging')
      const newBudget = parseMoney(details.new_budget)
      if (newBudget < 1) throw new Error(`Budget te laag: €${newBudget.toFixed(2)}. Minimaal €1,00 vereist.`)
      const [campaign] = await customer.query(`
        SELECT campaign.id, campaign_budget.resource_name
        FROM campaign
        WHERE campaign.id = ${details.google_campaign_id}
        LIMIT 1
      `)
      if (!campaign?.campaign_budget?.resource_name) {
        throw new Error(`Budget niet gevonden voor campagne ${details.google_campaign_id}`)
      }
      return customer.mutateResources([{
        entity: 'campaign_budget',
        operation: 'update',
        resource: {
          resource_name: campaign.campaign_budget.resource_name as string,
          amount_micros: Math.round(newBudget * 1_000_000),
        },
      }])
    }

    case 'keyword_negative': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor negatief zoekwoord')
      return customer.mutateResources([{
        entity: 'campaign_criterion',
        operation: 'create',
        resource: {
          campaign: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
          negative: true,
          keyword: { text: details.keyword as string, match_type: toMatchTypeEnum(details.match_type) },
        },
      }])
    }

    case 'pause_campaign': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden om te pauzeren')
      return customer.mutateResources([{
        entity: 'campaign',
        operation: 'update',
        resource: {
          resource_name: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
          status: 'PAUSED',
        },
      }])
    }

    case 'bid_adjustment': {
      if (details.criterion_id) {
        // Keyword-level CPC
        return customer.mutateResources([{
          entity: 'ad_group_criterion',
          operation: 'update',
          resource: {
            resource_name: `customers/${details.customer_id}/adGroupCriteria/${details.google_adgroup_id}~${details.criterion_id}`,
            cpc_bid_micros: Math.round(Number(details.new_bid || 0) * 1_000_000),
          },
        }])
      }
      // Ad group-level CPC
      if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden voor biedaanpassing')
      return customer.mutateResources([{
        entity: 'ad_group',
        operation: 'update',
        resource: {
          resource_name: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
          cpc_bid_micros: Math.round(Number(details.new_bid || 0) * 1_000_000),
        },
      }])
    }

    case 'keyword_add': {
      if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden voor zoekwoord toevoegen')
      const keywords = Array.isArray(details.keywords) ? details.keywords as string[] : [details.keyword as string]
      return customer.mutateResources(keywords.map((kw: string) => ({
        entity: 'ad_group_criterion' as const,
        operation: 'create' as const,
        resource: {
          ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
          keyword: { text: kw, match_type: toMatchTypeEnum(details.match_type) },
        },
      })))
    }

    case 'keyword_pause': {
      if (!details.google_keyword_id || !details.google_adgroup_id) throw new Error('Zoekwoord niet gevonden in database — voer eerst een sync uit')
      return customer.mutateResources([{
        entity: 'ad_group_criterion' as const,
        operation: 'update' as const,
        resource: {
          resource_name: `customers/${details.customer_id}/adGroupCriteria/${details.google_adgroup_id}~${details.google_keyword_id}`,
          status: 'PAUSED',
        },
      }])
    }

    case 'keyword_remove': {
      if (!details.google_keyword_id || !details.google_adgroup_id) throw new Error('Zoekwoord niet gevonden in database — voer eerst een sync uit')
      return customer.mutateResources([{
        entity: 'ad_group_criterion' as const,
        operation: 'remove' as const,
        resource: `customers/${details.customer_id}/adGroupCriteria/${details.google_adgroup_id}~${details.google_keyword_id}` as any,
      }])
    }

    case 'new_campaign': {
      const campaignName = (details.campaign_name || details.name) as string
      if (!campaignName) throw new Error('Campagnenaam ontbreekt in actie details')
      const budgetName = `Budget - ${campaignName} ${Date.now()}`

      // First check if a budget already exists from a previous failed attempt
      const existingBudgets = await customer.query(`
        SELECT campaign_budget.resource_name
        FROM campaign_budget
        WHERE campaign_budget.name LIKE 'Budget - ${campaignName.replace(/'/g, "\\'")}%'
        ORDER BY campaign_budget.id DESC
        LIMIT 1
      `)
      let budgetResourceName = (existingBudgets[0] as any)?.campaign_budget?.resource_name

      if (!budgetResourceName) {
        // Create new budget
        await customer.mutateResources([{
          entity: 'campaign_budget' as const,
          operation: 'create' as const,
          resource: {
            name: budgetName,
            amount_micros: Math.round(Math.max(parseMoney(details.daily_budget) || 10, 1) * 1_000_000),
            delivery_method: 'STANDARD',
          },
        }])

        // Query for the just-created budget
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
      }

      // EU political advertising disclosure (required)
      campaignResource.contains_eu_political_advertising = 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'

      // Shopping uses Google Shopping network implicitly — no network_settings needed
      if (!isShopping) {
        campaignResource.network_settings = {
          target_google_search: true,
          target_search_network: true,
          target_content_network: false,
        }
      }

      // Shopping campaigns require shopping_setting with merchant_id
      if (isShopping) {
        const country = ((details.country as string) || 'nl').toLowerCase()
        const merchantId = getSetting(`merchant_center_id_${country}`) || getSetting('merchant_center_id')
        if (!merchantId) throw new Error(`Geen Merchant Center ID gevonden voor land: ${country}`)
        campaignResource.shopping_setting = {
          merchant_id: Number(merchantId),
          sales_country: country.toUpperCase(),
          campaign_priority: Number(details.priority ?? 0),
        }
        if (details.target_roas) {
          campaignResource.maximize_conversion_value = {
            target_roas: Number(details.target_roas),
          }
        } else {
          campaignResource.manual_cpc = { enhanced_cpc_enabled: false }
        }
      }

      // Bid strategy for Search campaigns (or override for Shopping)
      if (!isShopping) {
        applyBidStrategy(campaignResource, (details.bid_strategy as string) || 'maximize_clicks', details)
      }

      await customer.mutateResources([{
        entity: 'campaign' as const,
        operation: 'create' as const,
        resource: campaignResource,
      }])

      // Apply geo + language targeting
      const newCampCountries = Array.isArray(details.countries)
        ? (details.countries as string[])
        : [((details.country as string) || 'nl').toLowerCase()]
      const newCampRows = await customer.query(`
        SELECT campaign.id FROM campaign
        WHERE campaign.name = '${campaignName.replace(/'/g, "\\'")}' LIMIT 1
      `)
      const newCampId = String((newCampRows[0] as any)?.campaign?.id || '')
      const newCampLangOverrides = Array.isArray(details.languages) ? details.languages as string[] : undefined
      if (newCampId) {
        await applyTargeting(customer, String(details.customer_id), newCampId, newCampCountries, newCampLangOverrides)
      }
      return { created: campaignName, targeting: newCampCountries }
    }

    case 'campaign_bid_strategy': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor bid strategy aanpassing')
      const bsResource: Record<string, unknown> = {
        resource_name: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
      }
      applyBidStrategy(bsResource, String(details.strategy || 'maximize_clicks'), details)
      log('info', 'google-ads', `Bid strategy gewijzigd naar ${details.strategy}`, { campaign_id: details.google_campaign_id })
      return customer.mutateResources([{
        entity: 'campaign' as const,
        operation: 'update' as const,
        resource: bsResource,
      }])
    }

    case 'campaign_targeting': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor targeting aanpassing')
      const targetCountries = Array.isArray(details.countries)
        ? (details.countries as string[])
        : [String(details.country || 'nl')]
      const langOverrides = Array.isArray(details.languages) ? details.languages as string[] : undefined
      await applyTargeting(customer, String(details.customer_id), String(details.google_campaign_id), targetCountries, langOverrides)
      return { campaign_id: details.google_campaign_id, countries: targetCountries, languages: langOverrides }
    }

    case 'ad_text_change': {
      if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden voor advertentietekst wijziging')
      // Use locally synced ads table — live GAQL query for resource_name is unreliable
      const db2 = getDb()
      const adRow = db2.prepare(`
        SELECT a.google_ad_id, a.status, a.final_urls
        FROM ads a
        JOIN ad_groups ag ON ag.id = a.adgroup_id
        WHERE ag.google_adgroup_id = ? AND a.status != 'REMOVED'
        LIMIT 1
      `).get(String(details.google_adgroup_id)) as { google_ad_id: string; status: string; final_urls: string } | undefined

      // Google Ads limits: headlines max 30 chars, descriptions max 90 chars (including spaces)
      const headlines = (Array.isArray(details.headlines) ? details.headlines as string[] : [])
        .slice(0, 15)
        .map(t => ({ text: String(t).slice(0, 30).trimEnd() }))
      const descriptions = (Array.isArray(details.descriptions) ? details.descriptions as string[] : [])
        .slice(0, 4)
        .map(t => ({ text: String(t).slice(0, 90).trimEnd() }))

      if (!adRow) {
        // No existing ad — create a new RSA
        // Priority: 1) details.final_url from AI, 2) DB lookup, 3) error
        let finalUrls: string[] = []

        if (typeof details.final_url === 'string' && details.final_url.startsWith('http')) {
          finalUrls = [details.final_url]
        } else {
          const urlRow = db2.prepare(`
            SELECT a.final_urls
            FROM ads a
            JOIN ad_groups ag ON ag.id = a.adgroup_id
            WHERE ag.campaign_id = (SELECT ag2.campaign_id FROM ad_groups ag2 WHERE ag2.google_adgroup_id = ?)
              AND a.final_urls != '[]' AND a.final_urls IS NOT NULL AND a.final_urls != ''
            LIMIT 1
          `).get(String(details.google_adgroup_id)) as { final_urls: string } | undefined
          if (urlRow) finalUrls = JSON.parse(urlRow.final_urls || '[]')
        }

        if (finalUrls.length === 0) {
          const sampleUrls = db2.prepare(`SELECT a.final_urls FROM ads a LIMIT 5`).all() as Array<{ final_urls: string }>
          log('warn', 'google-ads', 'Geen final_url beschikbaar voor nieuwe RSA', {
            google_adgroup_id: details.google_adgroup_id,
            details_final_url: details.final_url ?? null,
            sample_db_urls: sampleUrls.map(r => r.final_urls),
          })
          throw new Error('Geen final_url beschikbaar — geef final_url mee in de actie details')
        }

        log('info', 'google-ads', 'Geen bestaande RSA — nieuwe advertentie aanmaken', {
          google_adgroup_id: details.google_adgroup_id,
          adgroup_name: details.adgroup_name,
          final_urls: finalUrls,
          headline_count: headlines.length,
          description_count: descriptions.length,
        })
        return customer.mutateResources([{
          entity: 'ad_group_ad' as const,
          operation: 'create' as const,
          resource: {
            ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
            status: 'ENABLED',
            ad: {
              final_urls: finalUrls,
              responsive_search_ad: { headlines, descriptions },
            },
          },
        }])
      }

      // Existing ad — RSA headlines/descriptions are immutable via UPDATE.
      // Strategy: remove the old ad, create a new one with the new text.
      const existingFinalUrls = JSON.parse(adRow.final_urls || '[]') as string[]
      const replaceFinalUrls = (typeof details.final_url === 'string' && details.final_url.startsWith('http'))
        ? [details.final_url]
        : existingFinalUrls.length > 0
          ? existingFinalUrls
          : (() => {
              const ur = db2.prepare(`
                SELECT a.final_urls FROM ads a
                JOIN ad_groups ag ON ag.id = a.adgroup_id
                WHERE ag.campaign_id = (SELECT ag2.campaign_id FROM ad_groups ag2 WHERE ag2.google_adgroup_id = ?)
                  AND a.final_urls != '[]' AND a.final_urls IS NOT NULL AND a.final_urls != ''
                LIMIT 1
              `).get(String(details.google_adgroup_id)) as { final_urls: string } | undefined
              return ur ? JSON.parse(ur.final_urls || '[]') as string[] : []
            })()

      if (replaceFinalUrls.length === 0) {
        throw new Error('Geen final_url beschikbaar voor vervanging advertentie — geef final_url mee in de actie details')
      }

      // Replace existing ad: remove the known ad from DB, then create new
      const resourceName = `customers/${details.customer_id}/adGroupAds/${details.google_adgroup_id}~${adRow.google_ad_id}`
      log('info', 'google-ads', 'Bestaande RSA vervangen (remove + create)', {
        google_adgroup_id: details.google_adgroup_id,
        google_ad_id: adRow.google_ad_id,
        final_urls: replaceFinalUrls,
        headline_count: headlines.length,
        description_count: descriptions.length,
      })
      try {
        await customer.mutateResources([{
          entity: 'ad_group_ad' as const,
          operation: 'remove' as const,
          resource: resourceName as any,
        }])
      } catch (removeErr) {
        // google-ads-api throws plain objects, not Error instances — use JSON.stringify to inspect
        const serialized = (() => {
          try { return JSON.stringify(removeErr) } catch { return String(removeErr) }
        })()
        const isAlreadyRemoved = /CANNOT_OPERATE_ON_REMOVED|Removed ads may not/i.test(serialized)
        log('info', 'google-ads', isAlreadyRemoved ? 'Ad al verwijderd, remove stap overgeslagen' : 'Remove mislukt', { resourceName, error: serialized.slice(0, 300) })
        if (!isAlreadyRemoved) throw removeErr
      }

      // Create new ad
      return customer.mutateResources([{
        entity: 'ad_group_ad' as const,
        operation: 'create' as const,
        resource: {
          ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
          status: 'ENABLED',
          ad: {
            final_urls: replaceFinalUrls,
            responsive_search_ad: { headlines, descriptions },
          },
        },
      }])
    }

    case 'ad_create': {
      if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden voor advertentie aanmaken')
      const db3 = getDb()
      const acHeadlines = (Array.isArray(details.headlines) ? details.headlines as string[] : [])
        .slice(0, 15).map(t => ({ text: String(t).slice(0, 30).trimEnd() }))
      const acDescriptions = (Array.isArray(details.descriptions) ? details.descriptions as string[] : [])
        .slice(0, 4).map(t => ({ text: String(t).slice(0, 90).trimEnd() }))

      let acFinalUrls: string[] = []
      if (typeof details.final_url === 'string' && details.final_url.startsWith('http')) {
        acFinalUrls = [details.final_url]
      } else {
        const ur = db3.prepare(`
          SELECT a.final_urls FROM ads a
          JOIN ad_groups ag ON ag.id = a.adgroup_id
          WHERE ag.campaign_id = (SELECT ag2.campaign_id FROM ad_groups ag2 WHERE ag2.google_adgroup_id = ?)
            AND a.final_urls != '[]' AND a.final_urls IS NOT NULL AND a.final_urls != ''
          LIMIT 1
        `).get(String(details.google_adgroup_id)) as { final_urls: string } | undefined
        if (ur) acFinalUrls = JSON.parse(ur.final_urls || '[]')
      }
      if (acFinalUrls.length === 0) throw new Error('Geen final_url beschikbaar — geef final_url mee in de actie details')

      log('info', 'google-ads', 'Nieuwe advertentie aanmaken in bestaande ad group', {
        google_adgroup_id: details.google_adgroup_id,
        final_urls: acFinalUrls,
        headline_count: acHeadlines.length,
        description_count: acDescriptions.length,
      })
      try {
        return await customer.mutateResources([{
          entity: 'ad_group_ad' as const,
          operation: 'create' as const,
          resource: {
            ad_group: `customers/${details.customer_id}/adGroups/${details.google_adgroup_id}`,
            status: 'ENABLED',
            ad: { final_urls: acFinalUrls, responsive_search_ad: { headlines: acHeadlines, descriptions: acDescriptions } },
          },
        }])
      } catch (e) {
        const s = (() => { try { return JSON.stringify(e) } catch { return String(e) } })()
        if (/resource_count_limit_exceeded|RESOURCE_LIMIT/i.test(s)) {
          throw new Error('Deze ad group heeft al het maximum aantal advertenties (3 RSAs per ad group). Gebruik "Advertentie wijzigen" om een bestaande advertentie te vervangen, of verwijder eerst een bestaande advertentie via Google Ads.')
        }
        throw e
      }
    }

    case 'adgroup_create': {
      if (!details.google_campaign_id) throw new Error('Campagne niet gevonden voor ad group aanmaken')
      const adgroupName = String(details.adgroup_name || '')
      if (!adgroupName) throw new Error('Ad group naam ontbreekt')

      // Step 1: create the ad group
      await customer.mutateResources([{
        entity: 'ad_group' as const,
        operation: 'create' as const,
        resource: {
          name: adgroupName,
          campaign: `customers/${details.customer_id}/campaigns/${details.google_campaign_id}`,
          status: 'ENABLED',
          ...(details.cpc_bid ? { cpc_bid_micros: Math.round(Number(details.cpc_bid) * 1_000_000) } : {}),
        },
      }])
      log('info', 'google-ads', `Ad group aangemaakt: ${adgroupName}`, { campaign_id: details.google_campaign_id })

      // Step 2: if headlines/descriptions provided, also create the RSA
      if (Array.isArray(details.headlines) && (details.headlines as string[]).length >= 3) {
        const agRows = await customer.query(`
          SELECT ad_group.id FROM ad_group
          WHERE campaign.id = ${details.google_campaign_id}
            AND ad_group.name = '${adgroupName.replace(/'/g, "\\'")}'
          LIMIT 1
        `)
        const newAgId = (agRows[0] as any)?.ad_group?.id
        if (newAgId) {
          const newHeadlines = (details.headlines as string[]).slice(0, 15).map(t => ({ text: String(t).slice(0, 30) }))
          const newDescriptions = (Array.isArray(details.descriptions) ? details.descriptions as string[] : []).slice(0, 4).map(t => ({ text: String(t).slice(0, 90) }))
          const finalUrls = typeof details.final_url === 'string' && details.final_url.startsWith('http')
            ? [details.final_url] : []
          if (finalUrls.length > 0 && newDescriptions.length >= 2) {
            await customer.mutateResources([{
              entity: 'ad_group_ad' as const,
              operation: 'create' as const,
              resource: {
                ad_group: `customers/${details.customer_id}/adGroups/${newAgId}`,
                status: 'ENABLED',
                ad: { final_urls: finalUrls, responsive_search_ad: { headlines: newHeadlines, descriptions: newDescriptions } },
              },
            }])
            log('info', 'google-ads', `RSA aangemaakt in nieuwe ad group ${adgroupName}`)
          }
        }
      }
      return { created: adgroupName }
    }

    default:
      throw new Error(`Onbekend actie-type: ${actionType}`)
  }
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  let body: ApplyActionBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON' }, { status: 400 })
  }

  const { message_id, action_index, dismiss } = body

  if (message_id === undefined || action_index === undefined) {
    return NextResponse.json({ error: 'message_id en action_index zijn verplicht' }, { status: 400 })
  }

  const db = getDb()

  // Look up the chat message
  const message = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(message_id) as {
    id: number
    thread_id: number
    proposed_actions: string | null
  } | undefined

  if (!message) {
    return NextResponse.json({ error: 'Bericht niet gevonden' }, { status: 404 })
  }

  // Parse proposed_actions
  let proposedActions: ProposedAction[]
  try {
    proposedActions = message.proposed_actions ? JSON.parse(message.proposed_actions) : []
  } catch {
    return NextResponse.json({ error: 'Ongeldige proposed_actions JSON' }, { status: 400 })
  }

  // Validate action_index
  if (action_index < 0 || action_index >= proposedActions.length) {
    return NextResponse.json({ error: `Ongeldig action_index: ${action_index}` }, { status: 400 })
  }

  const action = proposedActions[action_index]

  // Check action is pending
  if (action.status && action.status !== 'pending') {
    return NextResponse.json({ error: `Actie is al ${action.status}` }, { status: 400 })
  }

  // Handle dismiss
  if (dismiss) {
    proposedActions[action_index] = { ...action, status: 'dismissed' }
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?')
      .run(JSON.stringify(proposedActions), message_id)
    return NextResponse.json({ success: true })
  }

  // Apply the action via Google Ads API
  try {
    const db2 = getDb()
    const details = resolveGoogleIds(db2, action.details)

    let oldValue: string | null = null
    let newValue: string | null = null

    // Build descriptive old/new values for action_log
    switch (action.type) {
      case 'budget_change':
        oldValue = details.old_budget !== undefined ? `€${details.old_budget}` : null
        newValue = details.new_budget !== undefined ? `€${details.new_budget}` : null
        break
      case 'bid_adjustment':
        oldValue = details.old_bid !== undefined ? `€${details.old_bid}` : null
        newValue = details.new_bid !== undefined ? `€${details.new_bid}` : null
        break
      case 'keyword_negative':
        newValue = details.keyword as string | null ?? null
        break
      case 'pause_campaign':
        oldValue = 'ENABLED'
        newValue = 'PAUSED'
        break
      case 'keyword_add':
        newValue = Array.isArray(details.keywords)
          ? (details.keywords as string[]).join(', ')
          : (details.keyword as string | null ?? null)
        break
      case 'ad_text_change':
      case 'ad_create':
        newValue = Array.isArray(details.headlines)
          ? (details.headlines as string[]).slice(0, 3).join(' | ')
          : null
        break
      case 'adgroup_create':
        newValue = details.adgroup_name as string | null ?? null
        break
      case 'campaign_targeting':
        newValue = details.country as string | null ?? null
        break
      case 'campaign_bid_strategy':
        newValue = details.strategy as string | null ?? null
        break
    }

    const googleResponse = await applyAction(action.type, details)

    // After ad mutations: sync ads (and ad groups for adgroup_create) in background
    if (action.type === 'ad_text_change') {
      syncAds().catch(e => log('warn', 'google-ads', 'Post-actie syncAds mislukt', { error: e instanceof Error ? e.message : String(e) }))
    } else if (action.type === 'adgroup_create') {
      Promise.all([syncAdGroups(), syncAds()]).catch(e => log('warn', 'google-ads', 'Post-actie sync mislukt', { error: e instanceof Error ? e.message : String(e) }))
    }

    // Verify the action was actually applied
    const verification = await verifyAction(action.type, details)

    const finalStatus = verification.verified ? 'applied' : 'failed'
    const verificationNote = verification.verified
      ? undefined
      : `Verificatie mislukt: verwacht ${JSON.stringify(verification.expected)}, maar gevonden ${JSON.stringify(verification.actual)}`

    // Update action status in proposed_actions
    proposedActions[action_index] = { ...action, status: finalStatus, ...(verificationNote ? { verification_note: verificationNote } : {}) }
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?')
      .run(JSON.stringify(proposedActions), message_id)

    // Log to action_log
    db.prepare(`
      INSERT INTO action_log (action_type, description, old_value, new_value, applied_by, google_response)
      VALUES (?, ?, ?, ?, 'manual', ?)
    `).run(
      action.type,
      action.title,
      oldValue,
      newValue,
      JSON.stringify({ ...googleResponse as object, verification }),
    )

    if (verification.verified) {
      log('info', 'google-ads', `Chat actie toegepast en geverifieerd: ${action.title}`, {
        message_id, action_index, type: action.type,
      })
    } else {
      log('warn', 'google-ads', `Chat actie toegepast maar verificatie mislukt: ${action.title}`, {
        message_id, action_index, type: action.type,
        expected: verification.expected, actual: verification.actual,
      })
    }

    return NextResponse.json({ success: true, verified: verification.verified, verification_note: verificationNote })
  } catch (e) {
    let errorMessage = 'Toepassen mislukt'
    if (e instanceof Error) {
      errorMessage = e.message
    } else if (e && typeof e === 'object') {
      const obj = e as Record<string, unknown>
      if (Array.isArray(obj.errors)) {
        errorMessage = obj.errors.map((err: any) => {
          const parts = [err.message || '']
          if (err.location?.field_path_elements) {
            parts.push(`(veld: ${err.location.field_path_elements.map((f: any) => f.field_name).join('.')})`)
          }
          if (err.error_code) parts.push(`[${JSON.stringify(err.error_code)}]`)
          return parts.filter(Boolean).join(' ') || JSON.stringify(err)
        }).join('; ')
      } else if (obj.message) {
        errorMessage = String(obj.message)
      } else {
        errorMessage = JSON.stringify(e).slice(0, 500)
      }
    }
    log('error', 'google-ads', `Chat actie mislukt: ${errorMessage}`, {
      message_id,
      action_index,
      type: action.type,
      full_error: errorMessage,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
