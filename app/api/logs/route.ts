import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const level = req.nextUrl.searchParams.get('level')
  const category = req.nextUrl.searchParams.get('category')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)

  const db = getDb()
  let where = 'WHERE 1=1'
  const params: unknown[] = []

  if (level && level !== 'all') {
    where += ' AND level = ?'
    params.push(level)
  }
  if (category && category !== 'all') {
    where += ' AND category = ?'
    params.push(category)
  }

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM logs ${where}`).get(...params) as { count: number }
  ).count

  params.push(limit, offset)
  const logs = db
    .prepare(`SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params)

  return NextResponse.json({ logs, total })
}
