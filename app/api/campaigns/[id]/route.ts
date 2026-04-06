import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req); if (denied) return denied
  const { id } = await ctx.params
  const db = getDb()

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id)
  if (!campaign) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  const metrics = db.prepare(
    'SELECT * FROM daily_metrics WHERE campaign_id = ? ORDER BY date DESC LIMIT 30'
  ).all(id)

  const adGroups = db.prepare(`
    SELECT ag.*,
      (SELECT COUNT(*) FROM keywords k WHERE k.adgroup_id = ag.id) as keyword_count,
      COALESCE(SUM(am.cost), 0) as total_cost,
      COALESCE(SUM(am.clicks), 0) as total_clicks,
      COALESCE(SUM(am.conversions), 0) as total_conversions,
      COALESCE(SUM(am.conversion_value), 0) as total_value,
      CASE WHEN SUM(am.cost) > 0 THEN SUM(am.conversion_value) / SUM(am.cost) ELSE 0 END as roas
    FROM ad_groups ag
    LEFT JOIN adgroup_metrics am ON am.adgroup_id = ag.id AND am.date >= date('now', '-7 days')
    WHERE ag.campaign_id = ?
    GROUP BY ag.id
    ORDER BY total_cost DESC
  `).all(id)

  const keywords = db.prepare(`
    SELECT k.*, ag.name as adgroup_name,
      SUM(km.cost) as total_cost, SUM(km.clicks) as total_clicks,
      SUM(km.conversions) as total_conversions, SUM(km.conversion_value) as total_value
    FROM keywords k
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-7 days')
    WHERE ag.campaign_id = ?
    GROUP BY k.id ORDER BY total_cost DESC
  `).all(id)

  const searchTerms = db.prepare(`
    SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks,
      SUM(conversions) as conversions, SUM(conversion_value) as value
    FROM search_terms WHERE campaign_id = ? AND date >= date('now', '-7 days')
    GROUP BY search_term ORDER BY cost DESC LIMIT 50
  `).all(id)

  const products = db.prepare(`
    SELECT product_title, product_id,
      SUM(cost) as total_cost, SUM(clicks) as total_clicks, SUM(impressions) as total_impressions,
      SUM(conversions) as total_conversions, SUM(conversion_value) as total_value,
      CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
    FROM product_metrics WHERE campaign_id = ? AND date >= date('now', '-30 days')
    GROUP BY product_title ORDER BY total_cost DESC LIMIT 50
  `).all(id)

  return NextResponse.json({ campaign, metrics, adGroups, keywords, searchTerms, products })
}
