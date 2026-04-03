import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { suggestion_id } = await req.json()
  if (!suggestion_id) return NextResponse.json({ error: 'suggestion_id is verplicht' }, { status: 400 })

  try {
    const { applySuggestion } = await import('@/lib/action-engine')
    await applySuggestion(suggestion_id, 'manual')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Toepassen mislukt' }, { status: 500 })
  }
}
