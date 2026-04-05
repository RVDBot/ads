import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

// Pricing per million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5':  { input: 0.80, output: 4 },
}

interface TokenRow {
  model: string | null
  input: number | null
  output: number | null
}

function calcCost(model: string | null, input: number, output: number): number {
  const pricing = MODEL_PRICING[model || ''] || MODEL_PRICING['claude-sonnet-4-6']
  return (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const db = getDb()

  const total = db
    .prepare('SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage')
    .get() as TokenRow

  const last7d = db
    .prepare(
      "SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-7 days')"
    )
    .get() as TokenRow

  const last30d = db
    .prepare(
      "SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-30 days')"
    )
    .get() as TokenRow

  // Per-model breakdown
  const byModelTotal = db
    .prepare('SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage GROUP BY model')
    .all() as TokenRow[]

  const byModel7d = db
    .prepare("SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-7 days') GROUP BY model")
    .all() as TokenRow[]

  const byModel30d = db
    .prepare("SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_usage WHERE created_at >= date('now', '-30 days') GROUP BY model")
    .all() as TokenRow[]

  function formatModelBreakdown(rows: TokenRow[]) {
    return rows.map(r => ({
      model: r.model || 'claude-sonnet-4-6',
      input: r.input ?? 0,
      output: r.output ?? 0,
      cost: calcCost(r.model, r.input ?? 0, r.output ?? 0),
    }))
  }

  const ti = total.input ?? 0
  const to = total.output ?? 0
  const l7i = last7d.input ?? 0
  const l7o = last7d.output ?? 0
  const l30i = last30d.input ?? 0
  const l30o = last30d.output ?? 0

  return NextResponse.json({
    total: { input: ti, output: to, cost: calcCost(null, ti, to), models: formatModelBreakdown(byModelTotal) },
    last7d: { input: l7i, output: l7o, cost: calcCost(null, l7i, l7o), models: formatModelBreakdown(byModel7d) },
    last30d: { input: l30i, output: l30o, cost: calcCost(null, l30i, l30o), models: formatModelBreakdown(byModel30d) },
  })
}
