'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import { apiFetch } from '@/lib/api'
import { formatCurrency, formatRoas, countryFlag } from '@/lib/utils'
import { useChatPanel } from '@/components/ChatProvider'

interface Campaign {
  id: number
  name: string
  type: string
  status: string
  country: string
  target_countries: string | null
  daily_budget: number
  bid_strategy: string | null
  target_roas: number | null
  start_date: string | null
}

interface DailyMetric {
  date: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  conversion_value: number
  roas: number
  avg_cpc: number
  ctr: number
}

interface AdGroup {
  id: number
  name: string
  status: string
  keyword_count: number
  total_cost: number
  total_clicks: number
  total_conversions: number
  total_value: number
  roas: number
}

interface Keyword {
  id: number
  text: string
  match_type: string
  bid: number | null
  status: string
  adgroup_name: string
  total_cost: number
  total_clicks: number
  total_conversions: number
  total_value: number
}

interface SearchTerm {
  search_term: string
  cost: number
  clicks: number
  conversions: number
  value: number
}

const MATCH_TYPE_MAP: Record<string, string> = {
  '2': 'EXACT', '3': 'PHRASE', '4': 'BROAD',
  EXACT: 'EXACT', PHRASE: 'PHRASE', BROAD: 'BROAD',
}

const matchTypeColors: Record<string, string> = {
  EXACT: 'bg-accent-subtle text-accent',
  PHRASE: 'bg-success-subtle text-success',
  BROAD: 'bg-warning-subtle text-warning',
}

function statusDotColor(status: string): string {
  if (status === 'ENABLED') return '#0f9960'
  if (status === 'PAUSED') return '#8b9098'
  return '#dc2626'
}

function roasColor(roas: number): string {
  if (roas >= 3) return '#0f9960'
  if (roas >= 1) return '#d97706'
  return '#dc2626'
}

function MetricsChart({ data }: { data: DailyMetric[] }) {
  if (data.length < 2) return null
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))

  const w = 700
  const h = 180
  const pad = { top: 10, right: 50, bottom: 24, left: 50 }
  const cw = w - pad.left - pad.right
  const ch = h - pad.top - pad.bottom

  const maxCost = Math.max(...sorted.map(d => d.cost), 1)
  const maxRoas = Math.max(...sorted.map(d => d.roas), 1)

  const xStep = cw / (sorted.length - 1)

  const costPoints = sorted.map((d, i) => ({
    x: pad.left + i * xStep,
    y: pad.top + ch - (d.cost / maxCost) * ch,
  }))
  const roasPoints = sorted.map((d, i) => ({
    x: pad.left + i * xStep,
    y: pad.top + ch - (d.roas / maxRoas) * ch,
  }))

  function smoothPath(pts: { x: number; y: number }[]) {
    let path = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(i + 2, pts.length - 1)]
      const t = 0.3
      path += ` C ${p1.x + (p2.x - p0.x) * t} ${p1.y + (p2.y - p0.y) * t}, ${p2.x - (p3.x - p1.x) * t} ${p2.y - (p3.y - p1.y) * t}, ${p2.x} ${p2.y}`
    }
    return path
  }

  const labels = sorted.filter((_, i) => i % Math.ceil(sorted.length / 6) === 0 || i === sorted.length - 1)

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="block">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={pad.left} x2={w - pad.right}
          y1={pad.top + ch * (1 - f)} y2={pad.top + ch * (1 - f)}
          stroke="var(--color-border-subtle)" strokeWidth="0.5" />
      ))}
      {/* Cost area */}
      <path d={`${smoothPath(costPoints)} L ${costPoints[costPoints.length - 1].x} ${pad.top + ch} L ${costPoints[0].x} ${pad.top + ch} Z`}
        fill="var(--color-accent)" fillOpacity="0.08" />
      {/* Cost line */}
      <path d={smoothPath(costPoints)} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      {/* ROAS line */}
      <path d={smoothPath(roasPoints)} fill="none" stroke="#0f9960" strokeWidth="1.5" strokeDasharray="4 2" />
      {/* Axis labels */}
      <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" className="fill-text-tertiary" fontSize="9">
        {formatCurrency(maxCost)}
      </text>
      <text x={w - pad.right + 6} y={pad.top + 4} textAnchor="start" className="fill-text-tertiary" fontSize="9">
        {maxRoas.toFixed(1)}x
      </text>
      {labels.map(d => {
        const i = sorted.indexOf(d)
        return (
          <text key={d.date} x={pad.left + i * xStep} y={h - 4} textAnchor="middle"
            className="fill-text-tertiary" fontSize="9">
            {d.date.slice(5)}
          </text>
        )
      })}
      {/* Legend */}
      <line x1={pad.left} y1={h - 14} x2={pad.left + 14} y2={h - 14} stroke="var(--color-accent)" strokeWidth="1.5" />
      <text x={pad.left + 18} y={h - 11} className="fill-text-tertiary" fontSize="9">Kosten</text>
      <line x1={pad.left + 60} y1={h - 14} x2={pad.left + 74} y2={h - 14} stroke="#0f9960" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={pad.left + 78} y={h - 11} className="fill-text-tertiary" fontSize="9">ROAS</text>
    </svg>
  )
}

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { openChat } = useChatPanel()
  const id = params.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [metrics, setMetrics] = useState<DailyMetric[]>([])
  const [adGroups, setAdGroups] = useState<AdGroup[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/campaigns/${id}`)
      .then(r => r.json())
      .then(d => {
        setCampaign(d.campaign)
        setMetrics(d.metrics || [])
        setAdGroups(d.adGroups || [])
        setKeywords(d.keywords || [])
        setSearchTerms(d.searchTerms || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <>
        <Nav />
        <main className="max-w-[1200px] mx-auto px-6 py-6">
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
          </div>
        </main>
      </>
    )
  }

  if (!campaign) {
    return (
      <>
        <Nav />
        <main className="max-w-[1200px] mx-auto px-6 py-6">
          <div className="text-center text-text-tertiary py-12">Campagne niet gevonden.</div>
        </main>
      </>
    )
  }

  const totals = metrics.reduce((acc, m) => ({
    cost: acc.cost + m.cost,
    clicks: acc.clicks + m.clicks,
    impressions: acc.impressions + m.impressions,
    conversions: acc.conversions + m.conversions,
    value: acc.value + m.conversion_value,
  }), { cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 })

  const avgRoas = totals.cost > 0 ? totals.value / totals.cost : 0

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.push('/campaigns')}
            className="text-text-tertiary hover:text-text-secondary transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: statusDotColor(campaign.status) }}
              title={campaign.status === 'ENABLED' ? 'Live' : campaign.status === 'PAUSED' ? 'Gepauzeerd' : campaign.status} />
            <h1 className="text-[16px] font-semibold text-text-primary truncate">{campaign.name}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-text-tertiary">{campaign.type}</span>
            {campaign.target_countries && (
              <span className="text-[11px] text-text-secondary">{campaign.target_countries}</span>
            )}
            {campaign.start_date && (
              <span className="text-[11px] text-text-tertiary">Gestart {new Date(campaign.start_date).toLocaleDateString('nl-NL')}</span>
            )}
            <button onClick={() => openChat('campaign', campaign.id, campaign.name)}
              className="px-3 py-1.5 bg-accent/10 text-accent text-[12px] font-semibold rounded-lg hover:bg-accent/20 transition-colors shrink-0">
              Vraag AI
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-5 gap-3 mb-5">
          {([
            ['Kosten (30d)', formatCurrency(totals.cost), ''],
            ['ROAS', formatRoas(avgRoas), avgRoas >= 3 ? 'text-success' : avgRoas >= 1 ? 'text-warning' : 'text-danger'],
            ['Klikken', totals.clicks.toLocaleString('nl-NL'), ''],
            ['Conversies', Math.round(totals.conversions).toLocaleString('nl-NL'), ''],
            ['Budget/dag', campaign.daily_budget ? formatCurrency(campaign.daily_budget) : '\u2014', ''],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="bg-surface-1 border border-border-subtle rounded-xl p-3">
              <div className="text-text-tertiary text-[11px] font-medium mb-1">{label}</div>
              <div className={`text-[16px] font-semibold ${color || 'text-text-primary'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Chart */}
        {metrics.length >= 2 && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4 mb-5">
            <div className="text-[13px] font-semibold text-text-primary mb-3">Prestaties (30 dagen)</div>
            <MetricsChart data={metrics} />
          </div>
        )}

        {/* Ad Groups */}
        {adGroups.length > 0 && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-border-subtle">
              <span className="text-[13px] font-semibold text-text-primary">Advertentiegroepen ({adGroups.length})</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Naam</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Status</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Zoekwoorden</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Kosten (7d)</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Klikken</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Conv.</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {adGroups.map((ag, i) => (
                  <tr key={ag.id} className={`border-b border-border-subtle last:border-0 transition-colors ${i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'} hover:bg-surface-hover`}>
                    <td className="px-4 py-2 text-[13px] font-medium text-text-primary">{ag.name}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusDotColor(ag.status) }} />
                        {ag.status === 'ENABLED' ? 'Live' : ag.status === 'PAUSED' ? 'Gepauzeerd' : ag.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{ag.keyword_count}</td>
                    <td className="px-4 py-2 text-[13px] text-right font-medium text-text-primary">{formatCurrency(ag.total_cost || 0)}</td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{ag.total_clicks || 0}</td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{Math.round(ag.total_conversions || 0)}</td>
                    <td className={`px-4 py-2 text-[13px] text-right font-semibold ${(ag.roas || 0) >= 3 ? 'text-success' : (ag.roas || 0) >= 1 ? 'text-warning' : 'text-danger'}`}>
                      {formatRoas(ag.roas || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Keywords */}
        {keywords.length > 0 && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-border-subtle">
              <span className="text-[13px] font-semibold text-text-primary">Zoekwoorden ({keywords.length})</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Zoekwoord</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Match</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Groep</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Kosten</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Klikken</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Conv.</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k, i) => {
                  const mt = MATCH_TYPE_MAP[k.match_type] || k.match_type
                  const roas = k.total_cost > 0 ? (k.total_value || 0) / k.total_cost : 0
                  return (
                    <tr key={k.id} className={`border-b border-border-subtle last:border-0 transition-colors ${i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'} hover:bg-surface-hover`}>
                      <td className="px-4 py-2 text-[13px] font-medium text-text-primary max-w-[200px] truncate">{k.text}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${matchTypeColors[mt] || 'bg-surface-3 text-text-tertiary'}`}>
                          {mt}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[12px] text-text-secondary truncate max-w-[150px]">{k.adgroup_name}</td>
                      <td className="px-4 py-2 text-[13px] text-right font-medium text-text-primary">{formatCurrency(k.total_cost || 0)}</td>
                      <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{k.total_clicks || 0}</td>
                      <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{Math.round(k.total_conversions || 0)}</td>
                      <td className={`px-4 py-2 text-[13px] text-right font-semibold ${roas >= 3 ? 'text-success' : roas >= 1 ? 'text-warning' : 'text-danger'}`}>
                        {formatRoas(roas)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Search Terms */}
        {searchTerms.length > 0 && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle">
              <span className="text-[13px] font-semibold text-text-primary">Zoekopdrachten ({searchTerms.length})</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2">Zoekterm</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Kosten</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Klikken</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Conversies</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2">Waarde</th>
                </tr>
              </thead>
              <tbody>
                {searchTerms.map((st, i) => (
                  <tr key={i} className={`border-b border-border-subtle last:border-0 transition-colors ${i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'} hover:bg-surface-hover`}>
                    <td className="px-4 py-2 text-[13px] font-medium text-text-primary">{st.search_term}</td>
                    <td className="px-4 py-2 text-[13px] text-right font-medium text-text-primary">{formatCurrency(st.cost || 0)}</td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{st.clicks || 0}</td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{Math.round(st.conversions || 0)}</td>
                    <td className="px-4 py-2 text-[13px] text-right text-text-secondary">{formatCurrency(st.value || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
