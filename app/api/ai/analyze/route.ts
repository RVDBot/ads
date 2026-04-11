import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  try {
    let period = 14
    let category: string | undefined
    try {
      const body = await req.json()
      if (body.period && [7, 14, 30, 90].includes(body.period)) period = body.period
      if (body.category && ['optimization', 'growth', 'branding'].includes(body.category)) {
        category = body.category
      }
    } catch { /* no body is fine, use default */ }

    const { runAnalysis, runAnalysisByCategory } = await import('@/lib/ai-analyzer')
    const { getDb } = await import('@/lib/db')
    const db = getDb()

    if (category) {
      const analysisId = await runAnalysisByCategory(category as any, period)
      const count = (db.prepare('SELECT COUNT(*) as count FROM ai_suggestions WHERE analysis_id = ?').get(analysisId) as { count: number }).count
      return NextResponse.json({ analysisId, category, suggestions: count })
    } else {
      const ids = await runAnalysis(period)
      const total = ids.reduce((sum, id) => {
        const row = db.prepare('SELECT COUNT(*) as count FROM ai_suggestions WHERE analysis_id = ?').get(id) as { count: number }
        return sum + row.count
      }, 0)
      return NextResponse.json({ analysisIds: ids, suggestions: total })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Analyse mislukt' }, { status: 500 })
  }
}
