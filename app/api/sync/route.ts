import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getSetting, setSetting } from '@/lib/settings'

let syncRunning = false

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied

  if (syncRunning) {
    return NextResponse.json({ status: 'already_running' })
  }

  syncRunning = true
  setSetting('sync_status', 'running')
  setSetting('sync_started_at', new Date().toISOString())

  // Fire-and-forget: start sync in background, respond immediately
  import('@/lib/sync').then(({ runFullSync }) =>
    runFullSync('manual').finally(() => { syncRunning = false })
  )

  return NextResponse.json({ status: 'started' })
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  return NextResponse.json({
    status: getSetting('sync_status') || 'idle',
    lastSyncAt: getSetting('last_sync_at') || null,
    lastErrors: JSON.parse(getSetting('last_sync_errors') || '[]'),
  })
}
