import { log } from './logger'
import { setSetting } from './settings'

export async function runFullSync(trigger: 'manual' | 'scheduled' = 'manual'): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = []
  log('info', 'sync', `Full sync gestart (${trigger})`)
  setSetting('sync_status', 'running')
  setSetting('sync_started_at', new Date().toISOString())

  // 1. Google Ads
  try {
    const { syncCampaigns, syncDailyMetrics, syncAdGroups, syncKeywords, syncKeywordMetrics, syncSearchTerms, syncAds, syncAdMetrics } = await import('./google-ads')
    await syncCampaigns()
    await syncDailyMetrics('LAST_30_DAYS')
    await syncAdGroups()
    await syncKeywords()
    await syncKeywordMetrics('LAST_30_DAYS')
    await syncSearchTerms('LAST_30_DAYS')
    await syncAds()
    await syncAdMetrics('LAST_30_DAYS')
    log('info', 'google-ads', 'Google Ads sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Google Ads: ${msg}`)
    log('error', 'google-ads', 'Google Ads sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  // 2. Merchant Center
  try {
    const { syncProducts } = await import('./merchant-center')
    await syncProducts()
    log('info', 'merchant', 'Merchant Center sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Merchant Center: ${msg}`)
    log('error', 'merchant', 'Merchant Center sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  // 3. GA4
  try {
    const { syncGA4Pages } = await import('./ga4')
    await syncGA4Pages('30daysAgo')
    log('info', 'ga4', 'GA4 sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`GA4: ${msg}`)
    log('error', 'ga4', 'GA4 sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  const success = errors.length === 0
  setSetting('sync_status', success ? 'success' : 'partial')
  setSetting('last_sync_at', new Date().toISOString())
  setSetting('last_sync_errors', JSON.stringify(errors))
  log(success ? 'info' : 'warn', 'sync', `Full sync ${success ? 'voltooid' : 'met fouten'}`, { errors })
  return { success, errors }
}
