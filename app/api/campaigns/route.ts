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

  const prevStart = new Date()
  prevStart.setDate(prevStart.getDate() - period * 2)
  const prevStartStr = prevStart.toISOString().split('T')[0]

  // Campaigns with metrics
  const campaignParams: unknown[] = [startStr]
  let countryFilter = ''
  if (country) { countryFilter = ' AND LOWER(c.country) = LOWER(?)'; campaignParams.push(country) }

  const campaigns = db.prepare(`
    SELECT c.*,
      SUM(dm.cost) as total_cost, SUM(dm.clicks) as total_clicks,
      SUM(dm.impressions) as total_impressions, SUM(dm.conversions) as total_conversions,
      SUM(dm.conversion_value) as total_value,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas,
      CAST(julianday('now') - julianday((SELECT MIN(date) FROM daily_metrics WHERE campaign_id = c.id)) AS INTEGER) as days_active
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= ?
    WHERE 1=1 ${countryFilter}
    GROUP BY c.id
    ORDER BY total_cost DESC
  `).all(...campaignParams)

  // KPI totals current period
  const kpiParams: unknown[] = [startStr]
  let kpiWhere = 'dm.date >= ?'
  if (country) { kpiWhere += ' AND LOWER(c.country) = LOWER(?)'; kpiParams.push(country) }

  const kpi = db.prepare(`
    SELECT SUM(dm.cost) as spend, SUM(dm.conversion_value) as revenue,
      SUM(dm.conversions) as conversions, SUM(dm.clicks) as clicks,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas,
      CASE WHEN SUM(dm.clicks) > 0 THEN SUM(dm.cost) / SUM(dm.clicks) ELSE 0 END as avg_cpc
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE ${kpiWhere}
  `).get(...kpiParams)

  // Previous period KPIs
  const prevParams: unknown[] = [prevStartStr, startStr]
  let prevWhere = 'dm.date >= ? AND dm.date < ?'
  if (country) { prevWhere += ' AND LOWER(c.country) = LOWER(?)'; prevParams.push(country) }

  const prevKpi = db.prepare(`
    SELECT SUM(dm.cost) as spend, SUM(dm.conversion_value) as revenue,
      SUM(dm.conversions) as conversions,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas,
      CASE WHEN SUM(dm.clicks) > 0 THEN SUM(dm.cost) / SUM(dm.clicks) ELSE 0 END as avg_cpc
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE ${prevWhere}
  `).get(...prevParams)

  // Daily ROAS for chart
  const dailyParams: unknown[] = [startStr]
  let dailyWhere = 'dm.date >= ?'
  if (country) { dailyWhere += ' AND LOWER(c.country) = LOWER(?)'; dailyParams.push(country) }

  const dailyRoas = db.prepare(`
    SELECT dm.date, SUM(dm.cost) as cost, SUM(dm.conversion_value) as value,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE ${dailyWhere}
    GROUP BY dm.date ORDER BY dm.date ASC
  `).all(...dailyParams)

  // Sparkline data: daily ROAS per campaign (last 30 days)
  const sparkStart = new Date()
  sparkStart.setDate(sparkStart.getDate() - 30)
  const sparkStartStr = sparkStart.toISOString().split('T')[0]

  const sparklines = db.prepare(`
    SELECT dm.campaign_id, dm.date,
      CASE WHEN dm.cost > 0 THEN dm.conversion_value / dm.cost ELSE 0 END as roas
    FROM daily_metrics dm
    WHERE dm.date >= ?
    ORDER BY dm.date ASC
  `).all(sparkStartStr) as { campaign_id: number; date: string; roas: number }[]

  const sparklineMap: Record<number, number[]> = {}
  for (const row of sparklines) {
    if (!sparklineMap[row.campaign_id]) sparklineMap[row.campaign_id] = []
    sparklineMap[row.campaign_id].push(row.roas)
  }

  // Attach sparklines to campaigns
  const campaignsWithSparklines = (campaigns as any[]).map(c => ({
    ...c,
    sparkline: sparklineMap[c.id] || [],
  }))

  // Spend per country
  const countryBreakdown = db.prepare(`
    SELECT c.country, SUM(dm.cost) as cost, SUM(dm.conversion_value) as value
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= ?
    GROUP BY c.country ORDER BY cost DESC
  `).all(startStr)

  return NextResponse.json({ campaigns: campaignsWithSparklines, kpi, prevKpi, dailyRoas, countryBreakdown })
}
