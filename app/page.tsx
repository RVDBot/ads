'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/Nav'
import KpiCard from '@/components/KpiCard'
import CountryFilter from '@/components/CountryFilter'
import PeriodFilter from '@/components/PeriodFilter'
import RoasChart from '@/components/RoasChart'
import CountryBreakdown from '@/components/CountryBreakdown'
import InsightCard from '@/components/InsightCard'
import { apiFetch, useSyncRefresh } from '@/lib/api'
import { formatCurrency, formatRoas } from '@/lib/utils'

export default function Dashboard() {
  const [country, setCountry] = useState('')
  const [period, setPeriod] = useState('7')
  const [data, setData] = useState<any>(null)
  const [insights, setInsights] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const syncRev = useSyncRefresh()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (country) params.set('country', country)
    apiFetch(`/api/campaigns?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))

    apiFetch('/api/ai/suggestions?limit=3&status=pending')
      .then(r => r.ok ? r.json() : { suggestions: [] })
      .then(d => setInsights(d.suggestions || []))
      .catch(() => setInsights([]))
  }, [country, period, syncRev])

  const kpi = data?.kpi
  const prevKpi = data?.prevKpi

  function pctChange(current: number, prev: number): { value: string; positive: boolean } | undefined {
    if (!prev || !current) return undefined
    const pct = ((current - prev) / prev * 100)
    return { value: `${Math.abs(pct).toFixed(1)}% vs vorige periode`, positive: pct >= 0 }
  }

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[16px] font-semibold text-text-primary">Dashboard</h1>
          <div className="flex items-center gap-2">
            <CountryFilter value={country} onChange={setCountry} />
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-5 gap-3 mb-5">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
          </div>
        ) : !kpi || (!kpi.spend && !kpi.revenue) ? (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl p-12 text-center">
            <p className="text-text-tertiary text-[14px]">Nog geen data. Configureer je API keys in Instellingen en start een sync.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3 mb-5">
              <KpiCard label="Ad Spend" value={formatCurrency(kpi.spend || 0)}
                change={pctChange(kpi.spend, prevKpi?.spend)} />
              <KpiCard label="Omzet" value={formatCurrency(kpi.revenue || 0)}
                change={pctChange(kpi.revenue, prevKpi?.revenue)} />
              <KpiCard label="ROAS" value={formatRoas(kpi.roas || 0)} valueColor="text-success"
                change={kpi.roas && prevKpi?.roas ? { value: `${(kpi.roas - prevKpi.roas).toFixed(1)} vs vorige periode`, positive: kpi.roas >= prevKpi.roas } : undefined} />
              <KpiCard label="Conversies" value={String(Math.round(kpi.conversions || 0))}
                change={pctChange(kpi.conversions, prevKpi?.conversions)} />
              <KpiCard label="Gem. CPC" value={formatCurrency(kpi.avg_cpc || 0)}
                change={kpi.avg_cpc && prevKpi?.avg_cpc ? { value: `${Math.abs(((kpi.avg_cpc - prevKpi.avg_cpc) / prevKpi.avg_cpc) * 100).toFixed(1)}% vs vorige periode`, positive: kpi.avg_cpc <= prevKpi.avg_cpc } : undefined} />
            </div>

            <div className="grid grid-cols-[2fr_1fr] gap-3 mb-5">
              <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
                <RoasChart data={data?.dailyRoas || []} />
              </div>
              <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
                <CountryBreakdown data={data?.countryBreakdown || []} />
              </div>
            </div>

            {/* AI Insights preview */}
            <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-accent flex items-center justify-center text-sm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <span className="text-[13px] font-bold text-text-primary">AI Inzichten</span>
              </div>
              {insights.length > 0 ? (
                <div className="space-y-2">
                  {insights.map((insight: any) => (
                    <InsightCard
                      key={insight.id}
                      title={insight.title}
                      description={insight.description}
                      priority={insight.priority || 'medium'}
                      type={insight.type || 'general'}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-text-tertiary text-[13px] text-center py-6">
                  Nog geen AI inzichten beschikbaar. Start een analyse via Instellingen.
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  )
}
