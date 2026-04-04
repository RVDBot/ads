import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const db = getDb()

  const actions = db.prepare(`
    SELECT al.*, s.title as suggestion_title, s.description as suggestion_description, s.priority, s.details as suggestion_details
    FROM action_log al
    LEFT JOIN ai_suggestions s ON s.id = al.suggestion_id
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset)

  const total = (db.prepare('SELECT COUNT(*) as count FROM action_log').get() as { count: number }).count

  return NextResponse.json({ actions, total })
}
