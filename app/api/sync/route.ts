import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { getSetting } from '@/lib/settings'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { runFullSync } = await import('@/lib/sync')
  const result = await runFullSync('manual')
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  return NextResponse.json({
    status: getSetting('sync_status') || 'idle',
    lastSyncAt: getSetting('last_sync_at') || null,
    lastErrors: JSON.parse(getSetting('last_sync_errors') || '[]'),
  })
}
