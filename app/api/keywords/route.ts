import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const country = req.nextUrl.searchParams.get('country')
  const period = parseInt(req.nextUrl.searchParams.get('period') || '7', 10)
  const db = getDb()

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - period)
  const startStr = startDate.toISOString().split('T')[0]

  let kwWhere = 'km.date >= ?'
  const kwParams: unknown[] = [startStr]
  if (country) { kwWhere += ' AND c.country = ?'; kwParams.push(country) }

  const keywords = db.prepare(`
    SELECT k.text, k.match_type, k.bid, k.status, ag.name as adgroup, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks, SUM(km.impressions) as impressions,
      SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
      CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas
    FROM keywords k
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND ${kwWhere}
    GROUP BY k.id ORDER BY cost DESC
  `).all(...kwParams)

  let stWhere = 'st.date >= ?'
  const stParams: unknown[] = [startStr]
  if (country) { stWhere += ' AND c.country = ?'; stParams.push(country) }

  const searchTerms = db.prepare(`
    SELECT st.search_term, SUM(st.cost) as cost, SUM(st.clicks) as clicks,
      SUM(st.conversions) as conversions, SUM(st.conversion_value) as value
    FROM search_terms st
    JOIN campaigns c ON c.id = st.campaign_id
    WHERE ${stWhere}
    GROUP BY st.search_term ORDER BY cost DESC LIMIT 100
  `).all(...stParams)

  const wasters = db.prepare(`
    SELECT k.text, k.match_type, c.name as campaign,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks
    FROM keywords k
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= ?
    GROUP BY k.id HAVING SUM(km.cost) > 5 AND SUM(km.conversions) = 0
    ORDER BY cost DESC
  `).all(startStr)

  return NextResponse.json({ keywords, searchTerms, wasters })
}
