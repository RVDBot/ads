import { google } from 'googleapis'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

const DOMAINS = ['com', 'nl', 'de', 'fr', 'es', 'it'] as const

async function syncGA4ForProperty(propertyId: string, domain: string, startDate: string) {
  const auth = new google.auth.OAuth2(
    getSetting('google_ads_client_id'),
    getSetting('google_ads_client_secret')
  )
  auth.setCredentials({ refresh_token: getSetting('google_ads_refresh_token') })

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth })

  const res = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate: 'today' }],
      dimensions: [
        { name: 'pagePath' },
        { name: 'date' },
        { name: 'country' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'screenPageViewsPerSession' },
      ],
      limit: '10000',
    },
  })

  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO ga4_pages (page_path, date, sessions, bounce_rate, avg_session_duration, pages_per_session, country)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_path, date, country) DO UPDATE SET
      sessions = excluded.sessions, bounce_rate = excluded.bounce_rate,
      avg_session_duration = excluded.avg_session_duration, pages_per_session = excluded.pages_per_session
  `)

  const rows = res.data.rows || []
  const tx = db.transaction(() => {
    for (const row of rows) {
      const dims = row.dimensionValues || []
      const mets = row.metricValues || []
      const date = dims[1]?.value || ''
      const formattedDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
      stmt.run(
        dims[0]?.value, formattedDate,
        parseInt(mets[0]?.value || '0'),
        parseFloat(mets[1]?.value || '0'),
        parseFloat(mets[2]?.value || '0'),
        parseFloat(mets[3]?.value || '0'),
        dims[2]?.value || domain
      )
    }
  })
  tx()

  return rows.length
}

export async function syncGA4Pages(startDate: string = '30daysAgo') {
  let totalAll = 0

  for (const domain of DOMAINS) {
    const propertyId = getSetting(`ga4_property_id_${domain}`)
    if (!propertyId) continue

    const count = await syncGA4ForProperty(propertyId, domain, startDate)
    totalAll += count
    log('info', 'ga4', `${count} pagina-rijen gesynchroniseerd voor .${domain}`)
  }

  if (totalAll === 0) {
    // Fallback: check old single setting
    const legacyId = getSetting('ga4_property_id')
    if (legacyId) {
      totalAll = await syncGA4ForProperty(legacyId, 'com', startDate)
      log('info', 'ga4', `${totalAll} pagina-rijen gesynchroniseerd (legacy single ID)`)
      return
    }
    throw new Error('Geen GA4 Property IDs geconfigureerd')
  }

  log('info', 'ga4', `Totaal ${totalAll} pagina-rijen gesynchroniseerd over alle domeinen`)
}
