import { GoogleAdsApi } from 'google-ads-api'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

function getClient() {
  const client = new GoogleAdsApi({
    client_id: getSetting('google_ads_client_id'),
    client_secret: getSetting('google_ads_client_secret'),
    developer_token: getSetting('google_ads_developer_token'),
  })

  return client.Customer({
    customer_id: getSetting('google_ads_customer_id'),
    login_customer_id: getSetting('google_ads_mcc_id') || undefined,
    refresh_token: getSetting('google_ads_refresh_token'),
  })
}

export { getClient as getGoogleAdsClient }

// Google Ads API returns numeric enums for campaign type
const CAMPAIGN_TYPE_MAP: Record<string, string> = {
  '0': 'UNKNOWN', '1': 'UNKNOWN', '2': 'SEARCH', '3': 'DISPLAY',
  '4': 'SHOPPING', '5': 'HOTEL', '6': 'VIDEO', '7': 'MULTI_CHANNEL',
  '8': 'LOCAL', '9': 'SMART', '10': 'PERFORMANCE_MAX', '11': 'LOCAL_SERVICES',
  '12': 'DISCOVERY', '13': 'TRAVEL',
  // Also accept string values as-is
  SEARCH: 'SEARCH', DISPLAY: 'DISPLAY', SHOPPING: 'SHOPPING',
  VIDEO: 'VIDEO', PERFORMANCE_MAX: 'PERFORMANCE_MAX', SMART: 'SMART',
  DISCOVERY: 'DISCOVERY', LOCAL: 'LOCAL', HOTEL: 'HOTEL',
  LOCAL_SERVICES: 'LOCAL_SERVICES', TRAVEL: 'TRAVEL',
}

const CAMPAIGN_STATUS_MAP: Record<string, string> = {
  '0': 'UNKNOWN', '1': 'UNKNOWN', '2': 'ENABLED', '3': 'PAUSED', '4': 'REMOVED',
  ENABLED: 'ENABLED', PAUSED: 'PAUSED', REMOVED: 'REMOVED', UNKNOWN: 'UNKNOWN',
}

// Try to derive country from campaign name (e.g., "NL - Search" or "Shopping FR")
function deriveCountry(name: string): string | null {
  const countryCodes = ['nl', 'de', 'fr', 'es', 'it']
  const nameLower = name.toLowerCase()
  for (const code of countryCodes) {
    // Match country code as whole word (surrounded by non-alpha or at start/end)
    const regex = new RegExp(`(?:^|[^a-z])${code}(?:[^a-z]|$)`)
    if (regex.test(nameLower)) return code
  }
  // Check full country names
  const nameMap: Record<string, string> = {
    'nederland': 'nl', 'dutch': 'nl', 'netherlands': 'nl',
    'duitsland': 'de', 'germany': 'de', 'deutschland': 'de', 'german': 'de',
    'frankrijk': 'fr', 'france': 'fr', 'french': 'fr',
    'spanje': 'es', 'spain': 'es', 'spanish': 'es', 'españa': 'es',
    'italie': 'it', 'italy': 'it', 'italian': 'it', 'italia': 'it',
  }
  for (const [keyword, code] of Object.entries(nameMap)) {
    if (nameLower.includes(keyword)) return code
  }
  return null
}

export async function syncCampaigns() {
  const customer = getClient()
  const db = getDb()

  const campaigns = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.status,
      campaign.start_date,
      campaign_budget.amount_micros,
      campaign.bidding_strategy_type,
      campaign.target_roas.target_roas
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO campaigns (google_campaign_id, name, type, status, country, daily_budget, bid_strategy, target_roas, start_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(google_campaign_id) DO UPDATE SET
      name = excluded.name, type = excluded.type, status = excluded.status,
      country = COALESCE(excluded.country, campaigns.country),
      daily_budget = excluded.daily_budget, bid_strategy = excluded.bid_strategy,
      target_roas = excluded.target_roas, start_date = COALESCE(excluded.start_date, campaigns.start_date),
      updated_at = CURRENT_TIMESTAMP
  `)

  const tx = db.transaction(() => {
    for (const row of campaigns) {
      const c = row.campaign
      if (!c) continue
      const budget = row.campaign_budget?.amount_micros ? Number(row.campaign_budget.amount_micros) / 1_000_000 : null
      const rawType = String(c.advertising_channel_type || 'UNKNOWN')
      const mappedType = CAMPAIGN_TYPE_MAP[rawType] || rawType
      const rawStatus = String(c.status || 'ENABLED')
      const mappedStatus = CAMPAIGN_STATUS_MAP[rawStatus] || rawStatus
      const country = deriveCountry(c.name || '')
      // Google Ads returns start_date as "yyyy-MM-dd" string
      const startDate = (c as Record<string, unknown>)['start_date'] as string | null || null
      stmt.run(
        String(c.id), c.name,
        mappedType,
        mappedStatus,
        country,
        budget,
        String(c.bidding_strategy_type || ''),
        c.target_roas?.target_roas || null,
        startDate
      )
    }
  })
  tx()

  log('info', 'google-ads', `${campaigns.length} campagnes gesynchroniseerd`)

  // Sync geo targeting per campaign
  await syncGeoTargets()
}

// Geo target constant ID → country code mapping
// Source: https://developers.google.com/google-ads/api/reference/data/geotargets
const GEO_TARGET_COUNTRIES: Record<number, string> = {
  2528: 'NL', 2276: 'DE', 2250: 'FR', 2724: 'ES', 2380: 'IT',
  2040: 'AT', 2056: 'BE', 2756: 'CH', 2208: 'DK', 2826: 'GB',
  2840: 'US', 2124: 'CA', 2036: 'AU', 2616: 'PL', 2203: 'CZ',
  2348: 'HU', 2620: 'PT', 2752: 'SE', 2578: 'NO', 2246: 'FI',
  2372: 'IE', 2300: 'GR', 2642: 'RO', 2100: 'BG', 2191: 'HR',
  2705: 'SI', 2703: 'SK', 2440: 'LT', 2428: 'LV', 2233: 'EE',
  2442: 'LU', 2470: 'MT', 2196: 'CY',
}

async function syncGeoTargets() {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign_criterion.location.geo_target_constant
    FROM campaign_criterion
    WHERE campaign_criterion.type = 'LOCATION'
    AND campaign_criterion.negative = false
    AND campaign.status != 'REMOVED'
  `)

  // Group by campaign
  const campTargets: Record<string, string[]> = {}
  for (const row of rows) {
    const campId = String(row.campaign?.id)
    const geoConstant = row.campaign_criterion?.location?.geo_target_constant
    if (!campId || !geoConstant) continue

    // Extract ID from resource name like "geoTargetConstants/2528"
    const geoId = parseInt(String(geoConstant).split('/').pop() || '', 10)
    const countryCode = GEO_TARGET_COUNTRIES[geoId]
    if (!countryCode) continue

    if (!campTargets[campId]) campTargets[campId] = []
    if (!campTargets[campId].includes(countryCode)) {
      campTargets[campId].push(countryCode)
    }
  }

  // Update campaigns
  const stmt = db.prepare('UPDATE campaigns SET target_countries = ? WHERE google_campaign_id = ?')
  const tx = db.transaction(() => {
    for (const [campId, countries] of Object.entries(campTargets)) {
      stmt.run(countries.sort().join(', '), campId)
    }
  })
  tx()

  log('info', 'google-ads', `Geo targeting gesynchroniseerd voor ${Object.keys(campTargets).length} campagnes`)
}

export async function syncDailyMetrics(dateRange: string = 'LAST_30_DAYS') {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      campaign.id,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM campaign
    WHERE segments.date DURING ${dateRange}
    AND campaign.status != 'REMOVED'
  `)

  const findCampaign = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?')
  const stmt = db.prepare(`
    INSERT INTO daily_metrics (campaign_id, date, cost, clicks, impressions, conversions, conversion_value, roas, avg_cpc, ctr)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions,
      conversions = excluded.conversions, conversion_value = excluded.conversion_value,
      roas = excluded.roas, avg_cpc = excluded.avg_cpc, ctr = excluded.ctr
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const camp = findCampaign.get(String(row.campaign?.id)) as { id: number } | undefined
      if (!camp) { skipped++; continue }
      const cost = Number(row.metrics?.cost_micros || 0) / 1_000_000
      const clicks = Number(row.metrics?.clicks || 0)
      const impressions = Number(row.metrics?.impressions || 0)
      const conversions = Number(row.metrics?.conversions || 0)
      const convValue = Number(row.metrics?.conversions_value || 0)
      const roas = cost > 0 ? convValue / cost : 0
      const avgCpc = clicks > 0 ? cost / clicks : 0
      const ctr = impressions > 0 ? clicks / impressions : 0

      stmt.run(camp.id, row.segments?.date, cost, clicks, impressions, conversions, convValue, roas, avgCpc, ctr)
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} dagelijkse metric-rijen gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncAdGroups() {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      campaign.id
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `)

  const findCampaign = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?')
  const stmt = db.prepare(`
    INSERT INTO ad_groups (google_adgroup_id, campaign_id, name, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(google_adgroup_id) DO UPDATE SET
      name = excluded.name, status = excluded.status
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const camp = findCampaign.get(String(row.campaign?.id)) as { id: number } | undefined
      if (!camp) { skipped++; continue }
      const agStatus = CAMPAIGN_STATUS_MAP[String(row.ad_group?.status || 'ENABLED')] || String(row.ad_group?.status || 'ENABLED')
      stmt.run(String(row.ad_group?.id), camp.id, row.ad_group?.name, agStatus)
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} ad groups gesynchroniseerd${skipped ? ` (${skipped} overgeslagen, campaign niet gevonden)` : ''}`)
}

export async function syncKeywords() {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.cpc_bid_micros,
      ad_group_criterion.status,
      ad_group.id
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
  `)

  const findAdGroup = db.prepare('SELECT id FROM ad_groups WHERE google_adgroup_id = ?')
  const stmt = db.prepare(`
    INSERT INTO keywords (google_keyword_id, adgroup_id, text, match_type, bid, status)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_keyword_id) DO UPDATE SET
      text = excluded.text, match_type = excluded.match_type, bid = excluded.bid, status = excluded.status
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const ag = findAdGroup.get(String(row.ad_group?.id)) as { id: number } | undefined
      if (!ag) { skipped++; continue }
      const bid = row.ad_group_criterion?.cpc_bid_micros ? Number(row.ad_group_criterion.cpc_bid_micros) / 1_000_000 : null
      stmt.run(
        String(row.ad_group_criterion?.criterion_id), ag.id,
        row.ad_group_criterion?.keyword?.text, String(row.ad_group_criterion?.keyword?.match_type || 'BROAD'),
        bid, String(row.ad_group_criterion?.status || 'ENABLED')
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} zoekwoorden gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncKeywordMetrics(dateRange: string = 'LAST_30_DAYS') {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group_criterion.criterion_id,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM keyword_view
    WHERE segments.date DURING ${dateRange}
    AND ad_group_criterion.status != 'REMOVED'
  `)

  const findKeyword = db.prepare('SELECT id FROM keywords WHERE google_keyword_id = ?')
  const stmt = db.prepare(`
    INSERT INTO keyword_metrics (keyword_id, date, cost, clicks, impressions, conversions, conversion_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions,
      conversions = excluded.conversions, conversion_value = excluded.conversion_value
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const kw = findKeyword.get(String(row.ad_group_criterion?.criterion_id)) as { id: number } | undefined
      if (!kw) { skipped++; continue }
      stmt.run(
        kw.id, row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.impressions || 0),
        Number(row.metrics?.conversions || 0), Number(row.metrics?.conversions_value || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} keyword metric-rijen gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncSearchTerms(dateRange: string = 'LAST_30_DAYS') {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      campaign.id,
      search_term_view.search_term,
      metrics.cost_micros,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM search_term_view
    WHERE segments.date DURING ${dateRange}
  `)

  const findCampaign = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?')
  const stmt = db.prepare(`
    INSERT INTO search_terms (campaign_id, search_term, date, cost, clicks, conversions, conversion_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const camp = findCampaign.get(String(row.campaign?.id)) as { id: number } | undefined
      if (!camp) { skipped++; continue }
      stmt.run(
        camp.id, row.search_term_view?.search_term, row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.conversions || 0),
        Number(row.metrics?.conversions_value || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} zoektermen gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncAds() {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.status,
      ad_group.id
    FROM ad_group_ad
    WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    AND ad_group_ad.status != 'REMOVED'
  `)

  const findAdGroup = db.prepare('SELECT id FROM ad_groups WHERE google_adgroup_id = ?')
  const stmt = db.prepare(`
    INSERT INTO ads (google_ad_id, adgroup_id, headlines, descriptions, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_ad_id) DO UPDATE SET
      headlines = excluded.headlines, descriptions = excluded.descriptions, status = excluded.status
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const ag = findAdGroup.get(String(row.ad_group?.id)) as { id: number } | undefined
      if (!ag) { skipped++; continue }
      const headlines = (row.ad_group_ad?.ad?.responsive_search_ad?.headlines || []).map((h: any) => h.text)
      const descriptions = (row.ad_group_ad?.ad?.responsive_search_ad?.descriptions || []).map((d: any) => d.text)
      stmt.run(
        String(row.ad_group_ad?.ad?.id), ag.id,
        JSON.stringify(headlines), JSON.stringify(descriptions),
        String(row.ad_group_ad?.status || 'ENABLED')
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} advertenties gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncAdMetrics(dateRange: string = 'LAST_30_DAYS') {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group_ad.ad.id,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      segments.date
    FROM ad_group_ad
    WHERE segments.date DURING ${dateRange}
    AND ad_group_ad.status != 'REMOVED'
  `)

  const findAd = db.prepare('SELECT id FROM ads WHERE google_ad_id = ?')
  const stmt = db.prepare(`
    INSERT INTO ad_metrics (ad_id, date, cost, clicks, impressions, conversions)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ad_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions, conversions = excluded.conversions
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const ad = findAd.get(String(row.ad_group_ad?.ad?.id)) as { id: number } | undefined
      if (!ad) { skipped++; continue }
      stmt.run(
        ad.id, row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.impressions || 0),
        Number(row.metrics?.conversions || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} ad metric-rijen gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}

export async function syncShoppingPerformance(dateRange: string = 'LAST_30_DAYS') {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      campaign.id,
      segments.product_title,
      segments.product_item_id,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM shopping_performance_view
    WHERE segments.date DURING ${dateRange}
  `)

  const findCampaign = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?')
  const stmt = db.prepare(`
    INSERT INTO product_metrics (campaign_id, product_title, product_id, date, cost, clicks, impressions, conversions, conversion_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, product_id, date) DO UPDATE SET
      product_title = excluded.product_title,
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions,
      conversions = excluded.conversions, conversion_value = excluded.conversion_value
  `)

  let skipped = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const camp = findCampaign.get(String(row.campaign?.id)) as { id: number } | undefined
      if (!camp) { skipped++; continue }
      stmt.run(
        camp.id,
        row.segments?.product_title || 'Onbekend product',
        row.segments?.product_item_id || '',
        row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0),
        Number(row.metrics?.impressions || 0),
        Number(row.metrics?.conversions || 0),
        Number(row.metrics?.conversions_value || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length - skipped} shopping product-rijen gesynchroniseerd${skipped ? ` (${skipped} overgeslagen)` : ''}`)
}
