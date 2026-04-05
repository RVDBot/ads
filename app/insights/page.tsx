'use client'

import { useState, useEffect, useCallback } from 'react'
import Nav from '@/components/Nav'
import SuggestionCard from '@/components/SuggestionCard'
import { apiFetch, useSyncRefresh } from '@/lib/api'

interface Suggestion {
  id: number
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  type: string
  status: string
  details: string
  campaign_name?: string | null
  applied_at?: string
  result_roas_before?: number
  result_roas_after?: number
  analysis_date?: string
  model?: string
}

const typeOptions = [
  { value: '', label: 'Alle types' },
  { value: 'budget_change', label: 'Budget' },
  { value: 'bid_adjustment', label: 'Bieding' },
  { value: 'keyword_negative', label: 'Negatief KW' },
  { value: 'ad_text_change', label: 'Advertentie' },
  { value: 'new_campaign', label: 'Nieuwe Campagne' },
  { value: 'pause_campaign', label: 'Pauzeer' },
  { value: 'keyword_add', label: 'Zoekwoord' },
  { value: 'schedule_change', label: 'Schema' },
]

export default function InsightsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null)
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const syncRev = useSyncRefresh()

  const fetchSuggestions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (priorityFilter) params.set('priority', priorityFilter)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      const res = await apiFetch(`/api/ai/suggestions?${params}`)
      const data = await res.json()
      const items: Suggestion[] = data.suggestions || []
      setSuggestions(items)
      if (items.length > 0 && items[0].analysis_date) {
        setLastAnalysis(items[0].analysis_date)
      }
    } catch {
      /* empty */
    } finally {
      setLoading(false)
    }
  }, [priorityFilter, typeFilter, statusFilter, syncRev])

  useEffect(() => { fetchSuggestions() }, [fetchSuggestions])

  async function handleAnalyze(period = 14) {
    setShowPeriodMenu(false)
    setAnalyzing(true)
    try {
      await apiFetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      })
      await fetchSuggestions()
    } finally {
      setAnalyzing(false)
    }
  }

  const counts = {
    total: suggestions.length,
    pending: suggestions.filter(s => s.status === 'pending').length,
    applied: suggestions.filter(s => s.status === 'applied').length,
    dismissed: suggestions.filter(s => s.status === 'dismissed').length,
  }

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-[16px] font-semibold text-text-primary">AI Inzichten</h1>
            {lastAnalysis && (
              <p className="text-[11px] text-text-tertiary mt-0.5">
                Laatste analyse: {new Date(lastAnalysis).toLocaleString('nl-NL')}
              </p>
            )}
          </div>
          <div className="relative">
            <div className="flex">
              <button onClick={() => handleAnalyze(14)} disabled={analyzing}
                className="px-4 py-2 bg-accent text-white text-[12px] font-semibold rounded-l-lg hover:bg-accent-hover disabled:opacity-50 transition-colors">
                {analyzing ? 'Analyseren...' : 'Analyseer nu'}
              </button>
              <button onClick={() => setShowPeriodMenu(!showPeriodMenu)} disabled={analyzing}
                className="px-2 py-2 bg-accent text-white rounded-r-lg hover:bg-accent-hover disabled:opacity-50 transition-colors border-l border-white/20">
                <svg className={`w-3 h-3 transition-transform ${showPeriodMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {showPeriodMenu && (
              <div className="absolute right-0 mt-1 bg-surface-1 border border-border-subtle rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                {[
                  { days: 7, label: '7 dagen' },
                  { days: 14, label: '14 dagen' },
                  { days: 30, label: '30 dagen' },
                  { days: 90, label: '90 dagen' },
                ].map(opt => (
                  <button key={opt.days} onClick={() => handleAnalyze(opt.days)}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-2 transition-colors">
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Totaal', value: counts.total, color: 'text-text-primary' },
            { label: 'In afwachting', value: counts.pending, color: 'text-accent' },
            { label: 'Toegepast', value: counts.applied, color: 'text-success' },
            { label: 'Genegeerd', value: counts.dismissed, color: 'text-text-tertiary' },
          ].map(stat => (
            <div key={stat.label} className="bg-surface-1 border border-border-subtle rounded-xl px-4 py-3">
              <div className="text-[11px] text-text-tertiary font-medium">{stat.label}</div>
              <div className={`text-[20px] font-bold mt-0.5 ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* Priority filter */}
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle' },
              { value: 'high', label: 'Hoog' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Laag' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setPriorityFilter(opt.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  priorityFilter === opt.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="bg-surface-1 border border-border-subtle rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent">
            {typeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Status filter */}
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle' },
              { value: 'pending', label: 'In afwachting' },
              { value: 'applied', label: 'Toegepast' },
              { value: 'dismissed', label: 'Genegeerd' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  statusFilter === opt.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] text-text-tertiary ml-auto">
            {suggestions.length} suggestie{suggestions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Suggestions list */}
        <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-[32px] mb-3 opacity-40">&#x1F50D;</div>
              <div className="text-[14px] font-medium text-text-secondary mb-1">Nog geen analyses</div>
              <div className="text-[12px] text-text-tertiary max-w-sm mx-auto">
                Start een analyse om AI-suggesties te ontvangen, of configureer automatische analyses in Instellingen.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  description={s.description}
                  priority={s.priority}
                  type={s.type}
                  status={s.status}
                  details={s.details || '{}'}
                  campaignName={s.campaign_name}
                  appliedAt={s.applied_at}
                  roasBefore={s.result_roas_before}
                  roasAfter={s.result_roas_after}
                  onUpdate={fetchSuggestions}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
