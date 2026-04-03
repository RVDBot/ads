import { getSetting } from './settings'
import { log } from './logger'
import { getDb } from './db'

let syncTimer: ReturnType<typeof setTimeout> | null = null

export async function measureSuggestionResults(): Promise<void> {
  const db = getDb()
  const pending = db.prepare(`
    SELECT s.id, s.details, s.applied_at, s.result_roas_before
    FROM ai_suggestions s
    WHERE s.status = 'applied' AND s.result_roas_after IS NULL
      AND s.applied_at <= date('now', '-7 days')
  `).all() as Array<{ id: number; details: string; applied_at: string; result_roas_before: number }>

  for (const s of pending) {
    const details = JSON.parse(s.details)
    if (!details.campaign_id) continue

    // Look up local campaign ID
    const campaignRow = db.prepare('SELECT id FROM campaigns WHERE google_campaign_id = ?').get(String(details.campaign_id)) as { id: number } | undefined
    if (!campaignRow) continue

    const roas = db.prepare(`
      SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
      FROM daily_metrics WHERE campaign_id = ? AND date >= date(?, '+7 days')
    `).get(campaignRow.id, s.applied_at.split('T')[0]) as { roas: number } | undefined

    if (roas) {
      db.prepare('UPDATE ai_suggestions SET result_roas_after = ? WHERE id = ?').run(roas.roas, s.id)
      log('info', 'ai', `ROAS feedback: suggestie ${s.id} — voor: ${s.result_roas_before?.toFixed(1)}, na: ${roas.roas.toFixed(1)}`)
    }
  }
}

export function scheduleSyncs() {
  const freq = getSetting('sync_frequency')
  if (!freq || freq === 'manual') {
    log('info', 'system', 'Sync scheduler: alleen handmatig')
    return
  }

  const intervalMs = freq === '4x_day' ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

  async function tick() {
    try {
      const { runFullSync } = await import('./sync')
      await runFullSync('scheduled')

      // Measure ROAS impact of previously applied suggestions
      await measureSuggestionResults()

      // Optionally trigger AI analysis after sync
      const analysisFreq = getSetting('ai_analysis_frequency')
      if (analysisFreq === 'after_sync') {
        try {
          const { runAnalysis } = await import('./ai-analyzer')
          await runAnalysis()
        } catch (e) {
          log('error', 'ai', 'Auto-analyse na sync mislukt', { error: e instanceof Error ? e.message : String(e) })
        }

        // After analysis, auto-apply if configured
        try {
          const { autoApplySuggestions } = await import('./action-engine')
          await autoApplySuggestions()
        } catch (e) {
          log('error', 'google-ads', 'Auto-apply na analyse mislukt', { error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      log('error', 'sync', 'Scheduled sync mislukt', { error: e instanceof Error ? e.message : String(e) })
    }
    syncTimer = setTimeout(tick, intervalMs)
  }

  // Start first sync after a short delay
  syncTimer = setTimeout(tick, 60_000)
  log('info', 'system', `Sync scheduler gestart: elke ${intervalMs / 3600000}u`)
}

export function stopScheduler() {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
}
