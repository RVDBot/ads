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

export async function syncProducts() {
  const merchantId = getSetting('merchant_center_id')
  if (!merchantId) throw new Error('Merchant Center ID niet geconfigureerd')

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
        const price = p.price ? parseFloat(p.price.value || '0') : null
        const margin = p.customLabel0 || null
        const country = p.targetCountry || null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (p as any).destinations?.[0]?.status || 'approved'
        stmt.run(p.id, p.title, price, p.price?.currency || 'EUR', p.availability, margin, country, status)
      }
    })
    tx(products)
    total += products.length
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  log('info', 'merchant', `${total} producten gesynchroniseerd`)
}
