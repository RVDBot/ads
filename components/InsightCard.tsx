'use client'

interface InsightCardProps {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  type: string
  onApply?: () => void
  onDismiss?: () => void
}

const badges: Record<string, { label: string; className: string }> = {
  high: { label: 'HOGE IMPACT', className: 'bg-success-subtle text-success' },
  medium: { label: 'MEDIUM', className: 'bg-accent-subtle text-accent' },
  low: { label: 'LAAG', className: 'bg-surface-2 text-text-tertiary' },
}

export default function InsightCard({ title, description, priority, onApply, onDismiss }: InsightCardProps) {
  const badge = badges[priority] || badges.medium

  return (
    <div className="flex items-start gap-3 bg-surface-0 border border-border-subtle rounded-xl p-3">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 ${badge.className}`}>
        {badge.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text-primary">{title}</div>
        <div className="text-[12px] text-text-secondary mt-0.5">{description}</div>
      </div>
      {onApply && (
        <button onClick={onApply}
          className="px-3.5 py-1.5 bg-accent text-white text-[12px] font-semibold rounded-lg hover:bg-accent-hover shrink-0 self-center">
          Pas toe
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss}
          className="px-3 py-1.5 text-text-tertiary text-[12px] font-medium rounded-lg hover:bg-surface-2 shrink-0 self-center">
          Negeer
        </button>
      )}
    </div>
  )
}
