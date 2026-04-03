import { getSetting } from './settings'
import { log } from './logger'

let syncTimer: ReturnType<typeof setTimeout> | null = null

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

      // Optionally trigger AI analysis after sync
      const analysisFreq = getSetting('ai_analysis_frequency')
      if (analysisFreq === 'after_sync') {
        try {
          const { runAnalysis } = await import('./ai-analyzer')
          await runAnalysis()
        } catch (e) {
          log('error', 'ai', 'Auto-analyse na sync mislukt', { error: e instanceof Error ? e.message : String(e) })
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
