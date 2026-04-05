import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req); if (denied) return denied
  const { id } = await ctx.params
  const db = getDb()

  const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id)
  if (!thread) return NextResponse.json({ error: 'Thread niet gevonden' }, { status: 404 })

  const messages = db.prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC'
  ).all(id)

  return NextResponse.json({ thread, messages })
}
