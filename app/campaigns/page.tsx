'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/Nav'
import CountryFilter from '@/components/CountryFilter'
import PeriodFilter from '@/components/PeriodFilter'
import { apiFetch } from '@/lib/api'
import { formatCurrency, formatRoas, countryFlag } from '@/lib/utils'

interface Campaign {
  id: number
  name: string
  type: string
  status: string
  country: string
  daily_budget: number
  total_cost: number
  total_clicks: number
  total_conversions: number
  total_value: number
  roas: number
  sparkline: number[]
}

interface CampaignDetail {
  campaign: Campaign
  metrics: Array<{ date: string; cost: number; conversion_value: number; roas: number; clicks: number; conversions: number }>
  adGroups: Array<{ id: number; name: string; status: string; keyword_count: number }>
  keywords: Array<{ text: string; match_type: string; bid: number; adgroup_name: string; total_cost: number; total_clicks: number; total_conversions: number; total_value: number }>
  searchTerms: Array<{ search_term: string; cost: number; clicks: number; conversions: number; value: number }>
}

function roasColor(roas: number): string {
  if (roas >= 3) return '#0f9960'   // success green
  if (roas >= 1) return '#d97706'   // warning orange
  return '#dc2626'                   // danger red
}

function RoasSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const w = 100
  const h = 28
  const max = Math.max(...data, 0.1)
  const step = w / (data.length - 1)

  // Build segments with color based on ROAS
  const segments: string[] = []
  for (let i = 0; i < data.length - 1; i++) {
    const x1 = i * step
    const y1 = h - (data[i] / max) * (h - 2) - 1
    const x2 = (i + 1) * step
    const y2 = h - (data[i + 1] / max) * (h - 2) - 1
    const avgRoas = (data[i] + data[i + 1]) / 2
    segments.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${roasColor(avgRoas)}" stroke-width="1.5" stroke-linecap="round"/>`
    )
  }

  return (
    <svg
      width={w} height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      dangerouslySetInnerHTML={{ __html: segments.join('') }}
    />
  )
}

const statusDotColors: Record<string, string> = {
  ENABLED: 'bg-success',
  PAUSED: 'bg-text-tertiary',
  REMOVED: 'bg-danger',
}

const typeColors: Record<string, string> = {
  SEARCH: 'bg-accent-subtle text-accent',
  SHOPPING: 'bg-success-subtle text-success',
  PERFORMANCE_MAX: 'bg-warning-subtle text-warning',
}

const statusColors: Record<string, string> = {
  ENABLED: 'bg-success-subtle text-success',
  PAUSED: 'bg-surface-3 text-text-tertiary',
  REMOVED: 'bg-danger-subtle text-danger',
}

export default function CampaignsPage() {
  const [country, setCountry] = useState('')
  const [period, setPeriod] = useState('7')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (country) params.set('country', country)
    apiFetch(`/api/campaigns?${params}`)
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [country, period])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    setDetailLoading(true)
    apiFetch(`/api/campaigns/${selectedId}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setDetailLoading(false) })
      .catch(() => setDetailLoading(false))
  }, [selectedId])

  const filtered = campaigns.filter(c => {
    if (typeFilter && c.type !== typeFilter) return false
    if (statusFilter && c.status !== statusFilter) return false
    return true
  })

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[16px] font-semibold text-text-primary">Campagnes</h1>
          <div className="flex items-center gap-2">
            <CountryFilter value={country} onChange={setCountry} />
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
        </div>

        {/* Type + Status filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {['', 'SEARCH', 'SHOPPING', 'PERFORMANCE_MAX'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  typeFilter === t ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {t || 'Alle types'}
              </button>
            ))}
          </div>
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {['', 'ENABLED', 'PAUSED'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  statusFilter === s ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {s || 'Alle statussen'}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-text-tertiary ml-auto">
            {filtered.length} campagne{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-text-tertiary text-[13px]">
              Geen campagnes gevonden. Start een sync om data op te halen.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Naam</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Type</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Land</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2.5">Budget/dag</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2.5">Kosten ({period}d)</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2.5">ROAS</th>
                  <th className="text-center text-[11px] font-medium text-text-tertiary px-4 py-2.5">ROAS 30d</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2.5">Conversies</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.id}
                    onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                    className={`border-b border-border-subtle cursor-pointer transition-colors animate-row ${
                      selectedId === c.id ? 'bg-accent-subtle' : i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                    } hover:bg-surface-hover`}
                    style={{ animationDelay: `${i * 30}ms` }}>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary max-w-[250px]">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[c.status] || 'bg-text-tertiary'}`}
                          title={c.status} />
                        <span className="truncate">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeColors[c.type] || 'bg-surface-3 text-text-tertiary'}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">{c.country ? countryFlag(c.country) : '—'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{c.daily_budget ? formatCurrency(c.daily_budget) : '—'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-medium text-text-primary">{formatCurrency(c.total_cost || 0)}</td>
                    <td className={`px-4 py-2.5 text-[13px] text-right font-semibold ${(c.roas || 0) >= 3 ? 'text-success' : (c.roas || 0) >= 1 ? 'text-warning' : 'text-danger'}`}>
                      {formatRoas(c.roas || 0)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <RoasSparkline data={c.sparkline || []} />
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{Math.round(c.total_conversions || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="mt-4 bg-surface-1 border border-border-subtle rounded-2xl p-5">
            {detailLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-6 w-48 rounded-lg" />
                <div className="skeleton h-40 rounded-lg" />
              </div>
            ) : detail ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-[15px] font-bold text-text-primary">{detail.campaign.name}</h2>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {detail.campaign.type} &middot; {detail.campaign.country ? countryFlag(detail.campaign.country) : ''} &middot; {detail.campaign.status}
                    </p>
                  </div>
                  <button onClick={() => setSelectedId(null)}
                    className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1 rounded-md hover:bg-surface-2 transition-colors">
                    Sluiten
                  </button>
                </div>

                {/* Mini metrics chart */}
                {detail.metrics.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Dagelijkse metrics (laatste 30 dagen)</h3>
                    <div className="flex items-end gap-[2px] h-16">
                      {[...detail.metrics].reverse().map((m, i) => {
                        const maxCost = Math.max(...detail.metrics.map(x => x.cost || 0), 1)
                        const h = ((m.cost || 0) / maxCost) * 100
                        return (
                          <div key={i} className="flex-1 group relative">
                            <div
                              className={`w-full rounded-t-sm transition-colors ${(m.roas || 0) >= 3 ? 'bg-success' : (m.roas || 0) >= 1 ? 'bg-warning' : 'bg-danger'}`}
                              style={{ height: `${Math.max(h, 2)}%` }}
                              title={`${m.date}: ${formatCurrency(m.cost)} | ROAS ${formatRoas(m.roas || 0)}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Ad Groups */}
                {detail.adGroups.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Ad Groups ({detail.adGroups.length})</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {detail.adGroups.map(ag => (
                        <div key={ag.id} className="bg-surface-0 border border-border-subtle rounded-xl px-3 py-2">
                          <div className="text-[12px] font-medium text-text-primary truncate">{ag.name}</div>
                          <div className="text-[11px] text-text-tertiary">{ag.keyword_count} zoekwoorden &middot; {ag.status}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Keywords table */}
                {detail.keywords.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Zoekwoorden (top {detail.keywords.length})</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border-subtle">
                            <th className="text-left text-[10px] font-medium text-text-tertiary px-3 py-1.5">Zoekwoord</th>
                            <th className="text-left text-[10px] font-medium text-text-tertiary px-3 py-1.5">Match</th>
                            <th className="text-left text-[10px] font-medium text-text-tertiary px-3 py-1.5">Ad Group</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Kosten</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Klikken</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Conv.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.keywords.slice(0, 20).map((k, i) => (
                            <tr key={i} className="border-b border-border-subtle last:border-0">
                              <td className="px-3 py-1.5 text-[12px] text-text-primary">{k.text}</td>
                              <td className="px-3 py-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-tertiary font-medium">{k.match_type}</span>
                              </td>
                              <td className="px-3 py-1.5 text-[12px] text-text-secondary truncate max-w-[150px]">{k.adgroup_name}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-primary">{formatCurrency(k.total_cost || 0)}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-secondary">{k.total_clicks || 0}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-secondary">{Math.round(k.total_conversions || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Search terms */}
                {detail.searchTerms.length > 0 && (
                  <div>
                    <h3 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Zoekopdrachten (top {Math.min(detail.searchTerms.length, 20)})</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border-subtle">
                            <th className="text-left text-[10px] font-medium text-text-tertiary px-3 py-1.5">Zoekterm</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Kosten</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Klikken</th>
                            <th className="text-right text-[10px] font-medium text-text-tertiary px-3 py-1.5">Conversies</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.searchTerms.slice(0, 20).map((st, i) => (
                            <tr key={i} className="border-b border-border-subtle last:border-0">
                              <td className="px-3 py-1.5 text-[12px] text-text-primary">{st.search_term}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-primary">{formatCurrency(st.cost || 0)}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-secondary">{st.clicks || 0}</td>
                              <td className="px-3 py-1.5 text-[12px] text-right text-text-secondary">{Math.round(st.conversions || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </main>
    </>
  )
}
