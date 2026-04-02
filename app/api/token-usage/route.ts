import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const db = getDb()

  const total = db
    .prepare('SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage')
    .get() as { input: number | null; output: number | null }

  const last7d = db
    .prepare(
      "SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-7 days')"
    )
    .get() as { input: number | null; output: number | null }

  const last30d = db
    .prepare(
      "SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-30 days')"
    )
    .get() as { input: number | null; output: number | null }

  return NextResponse.json({
    total: { input: total.input ?? 0, output: total.output ?? 0 },
    last7d: { input: last7d.input ?? 0, output: last7d.output ?? 0 },
    last30d: { input: last30d.input ?? 0, output: last30d.output ?? 0 },
  })
}
