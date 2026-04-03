import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const status = req.nextUrl.searchParams.get('status')
  const priority = req.nextUrl.searchParams.get('priority')
  const type = req.nextUrl.searchParams.get('type')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10), 200)
  const db = getDb()

  let where = 'WHERE 1=1'
  const params: unknown[] = []
  if (status) { where += ' AND s.status = ?'; params.push(status) }
  if (priority) { where += ' AND s.priority = ?'; params.push(priority) }
  if (type) { where += ' AND s.type = ?'; params.push(type) }
  params.push(limit)

  const suggestions = db.prepare(`
    SELECT s.*, a.created_at as analysis_date, a.model
    FROM ai_suggestions s
    JOIN ai_analyses a ON a.id = s.analysis_id
    ${where}
    ORDER BY a.created_at DESC, s.priority DESC
    LIMIT ?
  `).all(...params)

  return NextResponse.json({ suggestions })
}

export async function PATCH(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const { id, status } = await req.json()
  if (!id || !['applied', 'dismissed'].includes(status)) {
    return NextResponse.json({ error: 'Ongeldige parameters' }, { status: 400 })
  }
  const db = getDb()
  db.prepare('UPDATE ai_suggestions SET status = ? WHERE id = ?').run(status, id)
  return NextResponse.json({ ok: true })
}
