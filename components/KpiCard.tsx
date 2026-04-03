interface KpiCardProps {
  label: string
  value: string
  change?: { value: string; positive: boolean }
  valueColor?: string
}

export default function KpiCard({ label, value, change, valueColor }: KpiCardProps) {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">{label}</div>
      <div className={`text-[22px] font-bold tracking-tight leading-none ${valueColor || 'text-text-primary'}`}>{value}</div>
      {change && (
        <div className={`text-[11px] font-medium mt-1.5 ${change.positive ? 'text-success' : 'text-danger'}`}>
          {change.positive ? '↑' : '↓'} {change.value}
        </div>
      )}
    </div>
  )
}
