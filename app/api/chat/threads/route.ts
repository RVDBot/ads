import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const db = getDb()

  const { searchParams } = new URL(req.url)
  const context_type = searchParams.get('context_type')
  const context_id = searchParams.get('context_id')

  const conditions: string[] = []
  const params: (string | number)[] = []

  if (context_type) {
    conditions.push('context_type = ?')
    params.push(context_type)
  }

  if (context_id !== null) {
    conditions.push('context_id = ?')
    params.push(Number(context_id))
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const threads = db.prepare(
    `SELECT * FROM chat_threads ${where} ORDER BY updated_at DESC LIMIT 50`
  ).all(...params)

  return NextResponse.json({ threads })
}
