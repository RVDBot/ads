import { google } from 'googleapis'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

function getAuthClient() {
  const oauth2 = new google.auth.OAuth2(
    getSetting('google_ads_client_id'),
    getSetting('google_ads_client_secret')
  )
  oauth2.setCredentials({ refresh_token: getSetting('google_ads_refresh_token') })
  return oauth2
}

const DOMAINS = ['com', 'nl', 'de', 'fr', 'es', 'it'] as const

async function syncMerchantForDomain(domain: string, merchantId: string) {
  const auth = getAuthClient()
  const content = google.content({ version: 'v2.1', auth })
  const db = getDb()

  let pageToken: string | undefined
  let total = 0

  const stmt = db.prepare(`
    INSERT INTO products (merchant_product_id, title, price, currency, availability, margin_label, country, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(merchant_product_id) DO UPDATE SET
      title = excluded.title, price = excluded.price, currency = excluded.currency,
      availability = excluded.availability, margin_label = excluded.margin_label,
      country = excluded.country, status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `)

  do {
    const res = await content.products.list({ merchantId, pageToken, maxResults: 250 })
    const products = res.data.resources || []

    const tx = db.transaction((items: typeof products) => {
      for (const p of items) {
        if (!p.id || !p.title) continue
        const price = p.price ? parseFloat(p.price.value || '0') : null
        const margin = p.customLabel0 || null
        const country = p.targetCountry || domain
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (p as any).destinations?.[0]?.status || 'approved'
        stmt.run(p.id, p.title, price, p.price?.currency || 'EUR', p.availability, margin, country, status)
      }
    })
    tx(products)
    total += products.length
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  return total
}

export async function syncProducts() {
  let totalAll = 0

  for (const domain of DOMAINS) {
    const merchantId = getSetting(`merchant_center_id_${domain}`)
    if (!merchantId) continue

    const count = await syncMerchantForDomain(domain, merchantId)
    totalAll += count
    log('info', 'merchant', `${count} producten gesynchroniseerd voor .${domain}`)
  }

  if (totalAll === 0) {
    // Fallback: check old single setting for backwards compatibility
    const legacyId = getSetting('merchant_center_id')
    if (legacyId) {
      totalAll = await syncMerchantForDomain('com', legacyId)
      log('info', 'merchant', `${totalAll} producten gesynchroniseerd (legacy single ID)`)
      return
    }
    throw new Error('Geen Merchant Center IDs geconfigureerd')
  }

  log('info', 'merchant', `Totaal ${totalAll} producten gesynchroniseerd over alle domeinen`)
}
