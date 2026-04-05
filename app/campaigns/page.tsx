'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'
import CountryFilter from '@/components/CountryFilter'
import PeriodFilter from '@/components/PeriodFilter'
import { apiFetch, useSyncRefresh } from '@/lib/api'
import { formatCurrency, formatRoas, countryFlag } from '@/lib/utils'

interface Campaign {
  id: number
  name: string
  type: string
  status: string
  country: string
  target_countries: string | null
  daily_budget: number
  total_cost: number
  total_clicks: number
  total_conversions: number
  total_value: number
  roas: number
  sparkline: number[]
}

function roasColor(roas: number): string {
  if (roas >= 3) return '#0f9960'
  if (roas >= 1) return '#d97706'
  return '#dc2626'
}

function RoasSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const w = 120
  const h = 28
  const pad = 1
  const max = Math.max(...data, 0.1)
  const step = w / (data.length - 1)

  const points = data.map((v, i) => ({
    x: i * step,
    y: h - pad - (v / max) * (h - pad * 2),
  }))

  const defs: string[] = []
  const gradId = `g${Math.random().toString(36).slice(2, 8)}`

  const stops = data.map((v, i) => {
    const offset = (i / (data.length - 1)) * 100
    return `<stop offset="${offset}%" stop-color="${roasColor(v)}"/>`
  })
  defs.push(`<defs><linearGradient id="${gradId}" x1="0" x2="1" y1="0" y2="0">${stops.join('')}</linearGradient></defs>`)

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]

    const tension = 0.3
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }

  const svg = `${defs.join('')}<path d="${path}" fill="none" stroke="url(#${gradId})" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`

  return (
    <svg
      width={w} height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function statusDotColor(status: string): string {
  if (status === 'ENABLED') return '#0f9960'
  if (status === 'PAUSED') return '#8b9098'
  if (status === 'REMOVED') return '#dc2626'
  return '#8b9098'
}

const typeColors: Record<string, string> = {
  SEARCH: 'bg-accent-subtle text-accent',
  SHOPPING: 'bg-success-subtle text-success',
  PERFORMANCE_MAX: 'bg-warning-subtle text-warning',
}

export default function CampaignsPage() {
  const [country, setCountry] = useState('')
  const [period, setPeriod] = useState('7')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<string>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const syncRev = useSyncRefresh()

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir(key === 'status' || key === 'name' ? 'asc' : 'desc')
    }
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (country) params.set('country', country)
    apiFetch(`/api/campaigns?${params}`)
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [country, period, syncRev])

  const filtered = campaigns
    .filter(c => {
      if (typeFilter && c.type !== typeFilter) return false
      if (statusFilter && c.status !== statusFilter) return false
      return true
    })
    .sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? ''
      const bVal = (b as any)[sortKey] ?? ''
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : (aVal as number) - (bVal as number)
      return sortDir === 'desc' ? -cmp : cmp
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
                {s === 'ENABLED' ? 'Live' : s === 'PAUSED' ? 'Gepauzeerd' : 'Alle statussen'}
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
                  {([
                    { key: 'name', label: 'Naam', align: 'left' },
                    { key: 'type', label: 'Type', align: 'left' },
                    { key: 'target_countries', label: 'Target', align: 'left' },
                    { key: 'daily_budget', label: 'Budget/dag', align: 'right' },
                    { key: 'total_cost', label: `Kosten (${period}d)`, align: 'right' },
                    { key: 'roas', label: 'ROAS', align: 'right' },
                    { key: '', label: 'ROAS 30d', align: 'center' },
                    { key: 'total_conversions', label: 'Conversies', align: 'right' },
                  ] as const).map(col => (
                    <th key={col.label}
                      onClick={() => col.key && handleSort(col.key)}
                      className={`text-${col.align} text-[11px] font-medium text-text-tertiary px-4 py-2.5 ${col.key ? 'cursor-pointer hover:text-text-secondary select-none' : ''}`}>
                      {col.label}
                      {col.key && sortKey === col.key && (
                        <span className="ml-0.5">{sortDir === 'desc' ? ' \u2193' : ' \u2191'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={c.id}
                    className={`border-b border-border-subtle transition-colors animate-row ${
                      i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                    } hover:bg-surface-hover`}
                    style={{ animationDelay: `${i * 30}ms` }}>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary max-w-[250px]">
                      <Link href={`/campaigns/${c.id}`} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: statusDotColor(c.status) }}
                          title={c.status === 'ENABLED' ? 'Live' : c.status === 'PAUSED' ? 'Gepauzeerd' : c.status} />
                        <span className="truncate">{c.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeColors[c.type] || 'bg-surface-3 text-text-tertiary'}`}>
                        {c.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-text-secondary">
                      {c.target_countries || (c.country ? countryFlag(c.country) : '\u2014')}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{c.daily_budget ? formatCurrency(c.daily_budget) : '\u2014'}</td>
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
      </main>
    </>
  )
}
