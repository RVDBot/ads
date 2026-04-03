import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  try {
    const { runAnalysis } = await import('@/lib/ai-analyzer')
    const analysisId = await runAnalysis()
    const { getDb } = await import('@/lib/db')
    const count = (getDb().prepare('SELECT COUNT(*) as count FROM ai_suggestions WHERE analysis_id = ?').get(analysisId) as { count: number }).count
    return NextResponse.json({ analysisId, suggestions: count })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Analyse mislukt' }, { status: 500 })
  }
}
