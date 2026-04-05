'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useChatPanel } from './ChatProvider'

interface SuggestionCardProps {
  id: number
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  type: string
  status: string
  details: string
  campaignName?: string | null
  appliedAt?: string
  roasBefore?: number
  roasAfter?: number
  onUpdate?: () => void
}

const priorityBadges: Record<string, { label: string; className: string }> = {
  high: { label: 'HOGE IMPACT', className: 'bg-success-subtle text-success' },
  medium: { label: 'MEDIUM', className: 'bg-accent-subtle text-accent' },
  low: { label: 'LAAG', className: 'bg-surface-2 text-text-tertiary' },
}

const typeBadges: Record<string, string> = {
  budget_change: 'Budget',
  bid_adjustment: 'Bieding',
  keyword_negative: 'Negatief KW',
  ad_text_change: 'Advertentie',
  new_campaign: 'Nieuwe Campagne',
  pause_campaign: 'Pauzeer',
  keyword_add: 'Zoekwoord',
  schedule_change: 'Schema',
}

export default function SuggestionCard({ id, title, description, priority, type, status, details, campaignName, appliedAt, roasBefore, roasAfter, onUpdate }: SuggestionCardProps) {
  const [loading, setLoading] = useState('')
  const { openChat } = useChatPanel()
  const badge = priorityBadges[priority] || priorityBadges.medium
  const [expanded, setExpanded] = useState(false)

  async function handleApply() {
    setLoading('apply')
    try {
      await apiFetch('/api/actions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion_id: id }),
      })
      onUpdate?.()
    } finally {
      setLoading('')
    }
  }

  async function handleDismiss() {
    setLoading('dismiss')
    try {
      await apiFetch('/api/ai/suggestions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed' }),
      })
      onUpdate?.()
    } finally {
      setLoading('')
    }
  }

  let parsedDetails: Record<string, unknown> = {}
  try { parsedDetails = JSON.parse(details) } catch { /* empty */ }

  return (
    <div className="bg-surface-0 border border-border-subtle rounded-xl p-4 relative">
      <button onClick={() => openChat('suggestion', id, title)}
        className="absolute top-3 right-3 p-1.5 text-text-tertiary hover:text-accent hover:bg-accent-subtle rounded-lg transition-colors"
        title="Bespreek met AI">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
      </button>
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1.5 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${badge.className}`}>{badge.label}</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-surface-2 text-text-tertiary whitespace-nowrap">{typeBadges[type] || type}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary">{title}</div>
          {campaignName && (
            <div className="text-[11px] text-accent font-medium mt-0.5">{campaignName}</div>
          )}
          <div className="text-[12px] text-text-secondary mt-1">{description}</div>

          {status === 'applied' && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] font-medium text-success bg-success-subtle px-2 py-0.5 rounded-md">Toegepast</span>
              {appliedAt && <span className="text-[11px] text-text-tertiary">{new Date(appliedAt).toLocaleDateString('nl-NL')}</span>}
              {roasBefore != null && roasAfter != null && (
                <span className={`text-[11px] font-medium ${roasAfter >= roasBefore ? 'text-success' : 'text-danger'}`}>
                  ROAS: {roasBefore.toFixed(1)}x &rarr; {roasAfter.toFixed(1)}x
                </span>
              )}
            </div>
          )}

          {status === 'dismissed' && (
            <span className="inline-block mt-2 text-[11px] font-medium text-text-tertiary bg-surface-2 px-2 py-0.5 rounded-md">Genegeerd</span>
          )}



          {Object.keys(parsedDetails).length > 0 && (
            <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-accent mt-2 hover:underline">
              {expanded ? 'Verberg details' : 'Bekijk details'}
            </button>
          )}

          {expanded && (
            <pre className="mt-2 text-[11px] text-text-secondary bg-surface-2 rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(parsedDetails, null, 2)}
            </pre>
          )}
        </div>

        {status === 'pending' && (
          <div className="flex gap-2 shrink-0 self-center">
            <button onClick={handleApply} disabled={!!loading}
              className="px-3.5 py-1.5 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent-hover disabled:opacity-50">
              {loading === 'apply' ? '...' : 'Pas toe'}
            </button>

            <button onClick={handleDismiss} disabled={!!loading}
              className="px-3 py-1.5 text-text-tertiary text-[12px] font-medium rounded-lg hover:bg-surface-2 disabled:opacity-50">
              {loading === 'dismiss' ? '...' : 'Negeer'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
