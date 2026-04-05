'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/Nav'
import CountryFilter from '@/components/CountryFilter'
import PeriodFilter from '@/components/PeriodFilter'
import { apiFetch, useSyncRefresh } from '@/lib/api'
import { formatCurrency, formatRoas, countryFlag } from '@/lib/utils'

interface Keyword {
  text: string
  match_type: string
  bid: number
  status: string
  adgroup: string
  campaign: string
  country: string
  cost: number
  clicks: number
  impressions: number
  conversions: number
  value: number
  roas: number
}

interface SearchTerm {
  search_term: string
  cost: number
  clicks: number
  conversions: number
  value: number
}

interface Waster {
  text: string
  match_type: string
  campaign: string
  cost: number
  clicks: number
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

export default function KeywordsPage() {
  const [country, setCountry] = useState('')
  const [period, setPeriod] = useState('7')
  const [tab, setTab] = useState<'keywords' | 'search_terms'>('keywords')
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([])
  const [wasters, setWasters] = useState<Waster[]>([])
  const [loading, setLoading] = useState(true)
  const [kwSort, setKwSort] = useState<string>('cost')
  const [kwDir, setKwDir] = useState<'asc' | 'desc'>('desc')
  const [stSort, setStSort] = useState<string>('cost')
  const [stDir, setStDir] = useState<'asc' | 'desc'>('desc')
  const syncRev = useSyncRefresh()

  function handleKwSort(key: string) {
    if (kwSort === key) { setKwDir(kwDir === 'desc' ? 'asc' : 'desc') }
    else { setKwSort(key); setKwDir(key === 'text' || key === 'campaign' ? 'asc' : 'desc') }
  }
  function handleStSort(key: string) {
    if (stSort === key) { setStDir(stDir === 'desc' ? 'asc' : 'desc') }
    else { setStSort(key); setStDir(key === 'search_term' ? 'asc' : 'desc') }
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (country) params.set('country', country)
    apiFetch(`/api/keywords?${params}`)
      .then(r => r.json())
      .then(d => {
        setKeywords(d.keywords || [])
        setSearchTerms(d.searchTerms || [])
        setWasters(d.wasters || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [country, period, syncRev])

  function sortList<T>(list: T[], key: string, dir: 'asc' | 'desc'): T[] {
    return [...list].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[key] ?? ''
      const bVal = (b as Record<string, unknown>)[key] ?? ''
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number)
      return dir === 'desc' ? -cmp : cmp
    })
  }

  const sortedKw = sortList(keywords, kwSort, kwDir)
  const sortedSt = sortList(searchTerms, stSort, stDir)

  function SortHeader({ label, sortKey, currentSort, currentDir, onSort, align = 'left' }: {
    label: string; sortKey: string; currentSort: string; currentDir: 'asc' | 'desc'; onSort: (k: string) => void; align?: string
  }) {
    return (
      <th onClick={() => onSort(sortKey)}
        className={`text-${align} text-[11px] font-medium text-text-tertiary px-4 py-2.5 cursor-pointer hover:text-text-secondary select-none`}>
        {label}
        {currentSort === sortKey && <span className="ml-0.5">{currentDir === 'desc' ? ' \u2193' : ' \u2191'}</span>}
      </th>
    )
  }

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[16px] font-semibold text-text-primary">Zoekwoorden</h1>
          <div className="flex items-center gap-2">
            <CountryFilter value={country} onChange={setCountry} />
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setTab('keywords')}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                tab === 'keywords' ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              Zoekwoorden ({keywords.length})
            </button>
            <button onClick={() => setTab('search_terms')}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                tab === 'search_terms' ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              Zoekopdrachten ({searchTerms.length})
            </button>
          </div>
        </div>

        {/* Keywords tab */}
        {tab === 'keywords' && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-8 space-y-3">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
              </div>
            ) : keywords.length === 0 ? (
              <div className="p-12 text-center text-text-tertiary text-[13px]">
                Geen zoekwoorden gevonden. Sync Google Ads data via Instellingen.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <SortHeader label="Zoekwoord" sortKey="text" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} />
                    <SortHeader label="Match" sortKey="match_type" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} />
                    <SortHeader label="Campagne" sortKey="campaign" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} />
                    <SortHeader label="Land" sortKey="country" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} />
                    <SortHeader label="Bod" sortKey="bid" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} align="right" />
                    <SortHeader label="Kosten" sortKey="cost" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} align="right" />
                    <SortHeader label="Klikken" sortKey="clicks" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} align="right" />
                    <SortHeader label="Conv." sortKey="conversions" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} align="right" />
                    <SortHeader label="ROAS" sortKey="roas" currentSort={kwSort} currentDir={kwDir} onSort={handleKwSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedKw.map((k, i) => {
                    const mt = MATCH_TYPE_MAP[k.match_type] || k.match_type
                    return (
                      <tr key={i}
                        className={`border-b border-border-subtle transition-colors ${
                          i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                        } hover:bg-surface-hover animate-row`}
                        style={{ animationDelay: `${i * 20}ms` }}>
                        <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary max-w-[200px] truncate">{k.text}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${matchTypeColors[mt] || 'bg-surface-3 text-text-tertiary'}`}>
                            {mt}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[12px] text-text-secondary truncate max-w-[150px]">{k.campaign}</td>
                        <td className="px-4 py-2.5 text-[13px]">{k.country ? countryFlag(k.country) : '\u2014'}</td>
                        <td className="px-4 py-2.5 text-[12px] text-right text-text-secondary">{k.bid ? formatCurrency(k.bid) : '\u2014'}</td>
                        <td className="px-4 py-2.5 text-[13px] text-right font-medium text-text-primary">{formatCurrency(k.cost || 0)}</td>
                        <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{k.clicks || 0}</td>
                        <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{Math.round(k.conversions || 0)}</td>
                        <td className={`px-4 py-2.5 text-[13px] text-right font-semibold ${(k.roas || 0) >= 3 ? 'text-success' : (k.roas || 0) >= 1 ? 'text-warning' : 'text-danger'}`}>
                          {formatRoas(k.roas || 0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Search terms tab */}
        {tab === 'search_terms' && (
          <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-8 space-y-3">
                {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
              </div>
            ) : searchTerms.length === 0 ? (
              <div className="p-12 text-center text-text-tertiary text-[13px]">
                Geen zoekopdrachten gevonden.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <SortHeader label="Zoekterm" sortKey="search_term" currentSort={stSort} currentDir={stDir} onSort={handleStSort} />
                    <SortHeader label="Kosten" sortKey="cost" currentSort={stSort} currentDir={stDir} onSort={handleStSort} align="right" />
                    <SortHeader label="Klikken" sortKey="clicks" currentSort={stSort} currentDir={stDir} onSort={handleStSort} align="right" />
                    <SortHeader label="Conversies" sortKey="conversions" currentSort={stSort} currentDir={stDir} onSort={handleStSort} align="right" />
                    <SortHeader label="Waarde" sortKey="value" currentSort={stSort} currentDir={stDir} onSort={handleStSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedSt.map((st, i) => (
                    <tr key={i}
                      className={`border-b border-border-subtle transition-colors ${
                        i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                      } hover:bg-surface-hover animate-row`}
                      style={{ animationDelay: `${i * 20}ms` }}>
                      <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary">{st.search_term}</td>
                      <td className="px-4 py-2.5 text-[13px] text-right font-medium text-text-primary">{formatCurrency(st.cost || 0)}</td>
                      <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{st.clicks || 0}</td>
                      <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{Math.round(st.conversions || 0)}</td>
                      <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{formatCurrency(st.value || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Wasters section */}
        {wasters.length > 0 && (
          <div className="mt-5">
            <h2 className="text-[14px] font-semibold text-text-primary mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-danger" />
              Verspillers
              <span className="text-[11px] font-normal text-text-tertiary">Zoekwoorden met kosten &gt; 5 euro en 0 conversies</span>
            </h2>
            <div className="bg-danger-subtle border border-danger/20 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-danger/10">
                    <th className="text-left text-[11px] font-medium text-danger px-4 py-2.5">Zoekwoord</th>
                    <th className="text-left text-[11px] font-medium text-danger px-4 py-2.5">Match</th>
                    <th className="text-left text-[11px] font-medium text-danger px-4 py-2.5">Campagne</th>
                    <th className="text-right text-[11px] font-medium text-danger px-4 py-2.5">Kosten</th>
                    <th className="text-right text-[11px] font-medium text-danger px-4 py-2.5">Klikken</th>
                  </tr>
                </thead>
                <tbody>
                  {wasters.map((w, i) => {
                    const mt = MATCH_TYPE_MAP[w.match_type] || w.match_type
                    return (
                      <tr key={i} className="border-b border-danger/10 last:border-0">
                        <td className="px-4 py-2.5 text-[13px] font-medium text-text-primary">{w.text}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${matchTypeColors[mt] || 'bg-surface-3 text-text-tertiary'}`}>
                            {mt}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[12px] text-text-secondary truncate max-w-[200px]">{w.campaign}</td>
                        <td className="px-4 py-2.5 text-[13px] text-right font-semibold text-danger">{formatCurrency(w.cost || 0)}</td>
                        <td className="px-4 py-2.5 text-[13px] text-right text-text-secondary">{w.clicks || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
