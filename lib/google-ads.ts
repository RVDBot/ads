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

export async function syncCampaigns() {
  const customer = getClient()
  const db = getDb()

  const campaigns = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign.status,
      campaign_budget.amount_micros,
      campaign.bidding_strategy_type,
      campaign.target_roas.target_roas
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO campaigns (google_campaign_id, name, type, status, daily_budget, bid_strategy, target_roas, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(google_campaign_id) DO UPDATE SET
      name = excluded.name, type = excluded.type, status = excluded.status,
      daily_budget = excluded.daily_budget, bid_strategy = excluded.bid_strategy,
      target_roas = excluded.target_roas, updated_at = CURRENT_TIMESTAMP
  `)

  const tx = db.transaction(() => {
    for (const row of campaigns) {
      const c = row.campaign
      if (!c) continue
      const budget = row.campaign_budget?.amount_micros ? Number(row.campaign_budget.amount_micros) / 1_000_000 : null
      stmt.run(
        String(c.id), c.name,
        String(c.advertising_channel_type || 'UNKNOWN'),
        String(c.status || 'ENABLED'),
        budget,
        String(c.bidding_strategy_type || ''),
        c.target_roas?.target_roas || null
      )
    }
  })
  tx()

  log('info', 'google-ads', `${campaigns.length} campagnes gesynchroniseerd`)
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

  const stmt = db.prepare(`
    INSERT INTO daily_metrics (campaign_id, date, cost, clicks, impressions, conversions, conversion_value, roas, avg_cpc, ctr)
    VALUES (
      (SELECT id FROM campaigns WHERE google_campaign_id = ?),
      ?, ?, ?, ?, ?, ?,
      CASE WHEN ? > 0 THEN ? / ? ELSE 0 END,
      CASE WHEN ? > 0 THEN ? / ? ELSE 0 END,
      CASE WHEN ? > 0 THEN CAST(? AS REAL) / ? ELSE 0 END
    )
    ON CONFLICT(campaign_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions,
      conversions = excluded.conversions, conversion_value = excluded.conversion_value,
      roas = excluded.roas, avg_cpc = excluded.avg_cpc, ctr = excluded.ctr
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      const cost = Number(row.metrics?.cost_micros || 0) / 1_000_000
      const clicks = Number(row.metrics?.clicks || 0)
      const impressions = Number(row.metrics?.impressions || 0)
      const conversions = Number(row.metrics?.conversions || 0)
      const convValue = Number(row.metrics?.conversions_value || 0)

      stmt.run(
        String(row.campaign?.id), row.segments?.date,
        cost, clicks, impressions, conversions, convValue,
        cost, convValue, cost,  // for ROAS calc
        clicks, cost, clicks,   // for avg_cpc calc
        impressions, clicks, impressions  // for CTR calc
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} dagelijkse metric-rijen gesynchroniseerd`)
}

export async function syncAdGroups() {
  const customer = getClient()
  const db = getDb()

  const rows = await customer.query(`
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      campaign.id AS campaign_id
    FROM ad_group
    WHERE ad_group.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO ad_groups (google_adgroup_id, campaign_id, name, status)
    VALUES (?, (SELECT id FROM campaigns WHERE google_campaign_id = ?), ?, ?)
    ON CONFLICT(google_adgroup_id) DO UPDATE SET
      name = excluded.name, status = excluded.status
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      stmt.run(String(row.ad_group?.id), String(row.campaign?.id), row.ad_group?.name, String(row.ad_group?.status || 'ENABLED'))
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} ad groups gesynchroniseerd`)
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
      ad_group.id AS adgroup_id
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO keywords (google_keyword_id, adgroup_id, text, match_type, bid, status)
    VALUES (?, (SELECT id FROM ad_groups WHERE google_adgroup_id = ?), ?, ?, ?, ?)
    ON CONFLICT(google_keyword_id) DO UPDATE SET
      text = excluded.text, match_type = excluded.match_type, bid = excluded.bid, status = excluded.status
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      const bid = row.ad_group_criterion?.cpc_bid_micros ? Number(row.ad_group_criterion.cpc_bid_micros) / 1_000_000 : null
      stmt.run(
        String(row.ad_group_criterion?.criterion_id), String(row.ad_group?.id),
        row.ad_group_criterion?.keyword?.text, String(row.ad_group_criterion?.keyword?.match_type || 'BROAD'),
        bid, String(row.ad_group_criterion?.status || 'ENABLED')
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} zoekwoorden gesynchroniseerd`)
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
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD'
    AND segments.date DURING ${dateRange}
    AND ad_group_criterion.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO keyword_metrics (keyword_id, date, cost, clicks, impressions, conversions, conversion_value)
    VALUES ((SELECT id FROM keywords WHERE google_keyword_id = ?), ?, ?, ?, ?, ?, ?)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions,
      conversions = excluded.conversions, conversion_value = excluded.conversion_value
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      stmt.run(
        String(row.ad_group_criterion?.criterion_id), row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.impressions || 0),
        Number(row.metrics?.conversions || 0), Number(row.metrics?.conversions_value || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} keyword metric-rijen gesynchroniseerd`)
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

  const stmt = db.prepare(`
    INSERT INTO search_terms (campaign_id, search_term, date, cost, clicks, conversions, conversion_value)
    VALUES ((SELECT id FROM campaigns WHERE google_campaign_id = ?), ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      stmt.run(
        String(row.campaign?.id), row.search_term_view?.search_term, row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.conversions || 0),
        Number(row.metrics?.conversions_value || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} zoektermen gesynchroniseerd`)
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
      ad_group.id AS adgroup_id
    FROM ad_group_ad
    WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    AND ad_group_ad.status != 'REMOVED'
  `)

  const stmt = db.prepare(`
    INSERT INTO ads (google_ad_id, adgroup_id, headlines, descriptions, status)
    VALUES (?, (SELECT id FROM ad_groups WHERE google_adgroup_id = ?), ?, ?, ?)
    ON CONFLICT(google_ad_id) DO UPDATE SET
      headlines = excluded.headlines, descriptions = excluded.descriptions, status = excluded.status
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      const headlines = (row.ad_group_ad?.ad?.responsive_search_ad?.headlines || []).map((h: any) => h.text)
      const descriptions = (row.ad_group_ad?.ad?.responsive_search_ad?.descriptions || []).map((d: any) => d.text)
      stmt.run(
        String(row.ad_group_ad?.ad?.id), String(row.ad_group?.id),
        JSON.stringify(headlines), JSON.stringify(descriptions),
        String(row.ad_group_ad?.status || 'ENABLED')
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} advertenties gesynchroniseerd`)
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

  const stmt = db.prepare(`
    INSERT INTO ad_metrics (ad_id, date, cost, clicks, impressions, conversions)
    VALUES ((SELECT id FROM ads WHERE google_ad_id = ?), ?, ?, ?, ?, ?)
    ON CONFLICT(ad_id, date) DO UPDATE SET
      cost = excluded.cost, clicks = excluded.clicks, impressions = excluded.impressions, conversions = excluded.conversions
  `)

  const tx = db.transaction(() => {
    for (const row of rows) {
      stmt.run(
        String(row.ad_group_ad?.ad?.id), row.segments?.date,
        Number(row.metrics?.cost_micros || 0) / 1_000_000,
        Number(row.metrics?.clicks || 0), Number(row.metrics?.impressions || 0),
        Number(row.metrics?.conversions || 0)
      )
    }
  })
  tx()

  log('info', 'google-ads', `${rows.length} ad metric-rijen gesynchroniseerd`)
}
