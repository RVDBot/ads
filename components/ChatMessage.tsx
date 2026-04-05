'use client'

import { useState, useMemo } from 'react'
import { apiFetch } from '@/lib/api'

interface ProposedAction {
  type: string
  title: string
  details: Record<string, unknown>
  status: string
  verification_note?: string
}

interface ChatMessageProps {
  id?: number
  role: 'user' | 'assistant'
  content: string
  proposedActions?: ProposedAction[]
  onActionApplied?: () => void
}

const typeLabels: Record<string, string> = {
  budget_change: 'Budget wijziging',
  bid_adjustment: 'Bod aanpassing',
  keyword_negative: 'Negatief zoekwoord',
  pause_campaign: 'Campagne pauzeren',
  keyword_add: 'Zoekwoord toevoegen',
  ad_text_change: 'Advertentie wijzigen',
  new_campaign: 'Nieuwe campagne',
  schedule_change: 'Schema wijzigen',
}

const statusBadges: Record<string, { label: string; className: string }> = {
  applied: { label: 'Toegepast ✓', className: 'bg-success-subtle text-success' },
  failed: { label: 'Verificatie mislukt', className: 'bg-danger-subtle text-danger' },
  dismissed: { label: 'Genegeerd', className: 'bg-surface-2 text-text-tertiary' },
}

function formatInline(text: string) {
  // Strip markdown headers (# ## ### etc) — keep the text
  let cleaned = text.replace(/^#{1,4}\s+/gm, '')
  // Strip horizontal rules
  cleaned = cleaned.replace(/^---+$/gm, '')

  const parts: (string | { type: string; content: string; href?: string })[] = []
  // Match: [link](url), **bold**, *italic*, _italic_
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > last) parts.push(cleaned.slice(last, match.index))
    if (match[1] && match[2]) parts.push({ type: 'link', content: match[1], href: match[2] })
    else if (match[3]) parts.push({ type: 'bold', content: match[3] })
    else if (match[4]) parts.push({ type: 'italic', content: match[4] })
    else if (match[5]) parts.push({ type: 'italic', content: match[5] })
    last = match.index + match[0].length
  }
  if (last < cleaned.length) parts.push(cleaned.slice(last))
  return parts
}

function FormattedText({ text }: { text: string }) {
  const parts = useMemo(() => formatInline(text), [text])
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>
        if (p.type === 'bold') return <strong key={i} className="font-semibold">{p.content}</strong>
        if (p.type === 'italic') return <em key={i}>{p.content}</em>
        if (p.type === 'link') return <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{p.content}</a>
        return <span key={i}>{p.content}</span>
      })}
    </>
  )
}

export default function ChatMessage({ id, role, content, proposedActions, onActionApplied }: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-accent text-white text-[13px] px-4 py-2.5 rounded-2xl rounded-br-md">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        <div className="bg-surface-1 border border-border-subtle text-[13px] text-text-primary px-4 py-2.5 rounded-2xl rounded-bl-md whitespace-pre-wrap">
          <FormattedText text={content} />
        </div>
        {proposedActions && proposedActions.length > 0 && (
          <div className="flex flex-col gap-2">
            {proposedActions.map((action, index) => (
              <ActionCard
                key={index}
                action={action}
                messageId={id}
                actionIndex={index}
                onActionApplied={onActionApplied}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionCard({ action, messageId, actionIndex, onActionApplied }: {
  action: ProposedAction
  messageId?: number
  actionIndex: number
  onActionApplied?: () => void
}) {
  const [loading, setLoading] = useState('')

  async function handleApply() {
    if (!messageId) return
    setLoading('apply')
    try {
      await apiFetch('/api/chat/apply-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, action_index: actionIndex }),
      })
      onActionApplied?.()
    } finally {
      setLoading('')
    }
  }

  async function handleDismiss() {
    if (!messageId) return
    setLoading('dismiss')
    try {
      await apiFetch('/api/chat/apply-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, action_index: actionIndex, dismiss: true }),
      })
      onActionApplied?.()
    } finally {
      setLoading('')
    }
  }

  const badge = statusBadges[action.status]

  return (
    <div className="bg-surface-0 border border-border-subtle rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent-subtle text-accent whitespace-nowrap">
          {typeLabels[action.type] || action.type}
        </span>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${badge.className}`}>
            {badge.label}
          </span>
        )}
      </div>
      <div className="text-[12px] font-semibold text-text-primary mb-1">{action.title}</div>
      {Object.keys(action.details).length > 0 && (
        <div className="flex flex-col gap-0.5 mb-2">
          {Object.entries(action.details).map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-2 text-[11px]">
              <span className="text-text-tertiary">{key}:</span>
              <span className="text-text-secondary font-medium">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
      {action.verification_note && (
        <div className="text-[11px] text-danger mt-1">{action.verification_note}</div>
      )}
      {action.status === 'pending' && (
        <div className="flex gap-2 mt-2">
          <button onClick={handleApply} disabled={!!loading}
            className="px-3 py-1 bg-accent text-white text-[11px] font-semibold rounded-lg hover:bg-accent-hover disabled:opacity-50">
            {loading === 'apply' ? '...' : 'Pas toe'}
          </button>
          <button onClick={handleDismiss} disabled={!!loading}
            className="px-3 py-1 text-text-tertiary text-[11px] font-medium rounded-lg hover:bg-surface-2 disabled:opacity-50">
            {loading === 'dismiss' ? '...' : 'Negeer'}
          </button>
        </div>
      )}
    </div>
  )
}
