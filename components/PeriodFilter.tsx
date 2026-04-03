interface PeriodFilterProps {
  value: string
  onChange: (period: string) => void
}

export default function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-[12px] px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-1 text-text-secondary">
      <option value="7">Laatste 7 dagen</option>
      <option value="30">Laatste 30 dagen</option>
    </select>
  )
}
