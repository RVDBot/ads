'use client'

import { useState, useEffect, useCallback } from 'react'
import Nav from '@/components/Nav'
import { apiFetch } from '@/lib/api'

interface ActionEntry {
  id: number
  suggestion_id: number | null
  action_type: string
  description: string
  old_value: string | null
  new_value: string | null
  applied_by: string
  created_at: string
  google_response: string | null
  suggestion_title: string | null
  suggestion_description: string | null
  priority: string | null
}

const actionTypeColors: Record<string, string> = {
  budget_change: 'bg-accent-subtle text-accent',
  bid_adjustment: 'bg-warning-subtle text-warning',
  keyword_negative: 'bg-danger-subtle text-danger',
  ad_text_change: 'bg-success-subtle text-success',
  new_campaign: 'bg-success-subtle text-success',
  pause_campaign: 'bg-surface-3 text-text-tertiary',
  keyword_add: 'bg-accent-subtle text-accent',
  schedule_change: 'bg-warning-subtle text-warning',
}

const actionTypeLabels: Record<string, string> = {
  budget_change: 'Budget',
  bid_adjustment: 'Bieding',
  keyword_negative: 'Negatief KW',
  ad_text_change: 'Advertentie',
  new_campaign: 'Nieuwe Campagne',
  pause_campaign: 'Pauzeer',
  keyword_add: 'Zoekwoord',
  schedule_change: 'Schema',
}

const appliedByStyles: Record<string, { label: string; className: string }> = {
  manual: { label: 'Handmatig', className: 'bg-accent-subtle text-accent' },
  semi_auto: { label: 'Semi-auto', className: 'bg-warning-subtle text-warning' },
  auto: { label: 'Automatisch', className: 'bg-[#7c3aed]/10 text-[#7c3aed]' },
}

const PAGE_SIZE = 25

export default function ActionsPage() {
  const [actions, setActions] = useState<ActionEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const fetchActions = useCallback(async (newOffset: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(newOffset) })
      const res = await apiFetch(`/api/actions/log?${params}`)
      const data = await res.json()
      if (newOffset === 0) {
        setActions(data.actions || [])
      } else {
        setActions(prev => [...prev, ...(data.actions || [])])
      }
      setTotal(data.total || 0)
    } catch {
      /* empty */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchActions(0) }, [fetchActions])

  function handleLoadMore() {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchActions(newOffset)
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id)
  }

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-[16px] font-semibold text-text-primary">Actie Log</h1>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              {total} actie{total !== 1 ? 's' : ''} uitgevoerd
            </p>
          </div>
        </div>

        <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
          {loading && actions.length === 0 ? (
            <div className="p-8 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
            </div>
          ) : actions.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-[32px] mb-3 opacity-40">&#x1F4CB;</div>
              <div className="text-[14px] font-medium text-text-secondary mb-1">Nog geen acties</div>
              <div className="text-[12px] text-text-tertiary max-w-sm mx-auto">
                Pas suggesties toe via de AI Inzichten pagina om hier de actiegeschiedenis te zien.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {actions.map(action => {
                const typeColor = actionTypeColors[action.action_type] || 'bg-surface-3 text-text-tertiary'
                const typeLabel = actionTypeLabels[action.action_type] || action.action_type
                const appliedBy = appliedByStyles[action.applied_by] || appliedByStyles.manual
                const isExpanded = expandedId === action.id

                let googleResp: Record<string, unknown> | null = null
                if (action.google_response) {
                  try { googleResp = JSON.parse(action.google_response) } catch { /* empty */ }
                }

                return (
                  <div key={action.id}
                    className="px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer"
                    onClick={() => toggleExpand(action.id)}>
                    <div className="flex items-center gap-3">
                      {/* Timestamp */}
                      <div className="shrink-0 w-[110px]">
                        <div className="text-[12px] font-medium text-text-primary">
                          {new Date(action.created_at).toLocaleDateString('nl-NL')}
                        </div>
                        <div className="text-[11px] text-text-tertiary">
                          {new Date(action.created_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      {/* Type badge */}
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${typeColor}`}>
                        {typeLabel}
                      </span>

                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-text-primary truncate">{action.description}</div>
                        {(action.old_value || action.new_value) && (
                          <div className="text-[11px] text-text-tertiary mt-0.5">
                            {action.old_value && <span>{action.old_value}</span>}
                            {action.old_value && action.new_value && <span className="mx-1">&rarr;</span>}
                            {action.new_value && <span className="font-medium text-text-secondary">{action.new_value}</span>}
                          </div>
                        )}
                      </div>

                      {/* Applied by badge */}
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${appliedBy.className}`}>
                        {appliedBy.label}
                      </span>

                      {/* Expand indicator */}
                      <svg className={`w-4 h-4 text-text-tertiary shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 ml-[110px] pl-3 border-l-2 border-border-subtle" onClick={e => e.stopPropagation()}>
                        {action.suggestion_title && (
                          <div className="mb-2">
                            <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">AI Suggestie</div>
                            <div className="text-[12px] font-medium text-text-primary">{action.suggestion_title}</div>
                            {action.suggestion_description && (
                              <div className="text-[11px] text-text-secondary mt-0.5">{action.suggestion_description}</div>
                            )}
                          </div>
                        )}

                        {googleResp && (
                          <div className="mt-2">
                            <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">Google Ads Response</div>
                            <pre className="text-[11px] text-text-secondary bg-surface-2 rounded-lg p-3 overflow-x-auto">
                              {JSON.stringify(googleResp, null, 2)}
                            </pre>
                          </div>
                        )}

                        {!action.suggestion_title && !googleResp && (
                          <div className="text-[11px] text-text-tertiary">Geen extra details beschikbaar.</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Load more */}
          {actions.length < total && (
            <div className="px-4 py-3 border-t border-border-subtle text-center">
              <button onClick={handleLoadMore} disabled={loading}
                className="text-[12px] font-medium text-accent hover:underline disabled:opacity-50">
                {loading ? 'Laden...' : `Meer laden (${actions.length} van ${total})`}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
