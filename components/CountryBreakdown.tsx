'use client'

import { countryFlag, countryName, formatCurrency } from '@/lib/utils'

interface CountryBreakdownProps {
  data: Array<{ country: string; cost: number; value: number }>
}

export default function CountryBreakdown({ data }: CountryBreakdownProps) {
  if (!data.length) return <div className="text-text-tertiary text-[13px] text-center py-8">Geen data</div>

  const maxCost = Math.max(...data.map(d => d.cost), 1)

  return (
    <div>
      <div className="text-[13px] font-semibold text-text-primary mb-3">Spend per Land</div>
      <div className="space-y-2.5">
        {data.map(d => (
          <div key={d.country}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-text-secondary font-medium">{countryFlag(d.country)} {countryName(d.country)}</span>
              <span className="text-text-primary font-semibold tabular-nums">{formatCurrency(d.cost)}</span>
            </div>
            <div className="bg-surface-2 rounded h-1.5">
              <div className="bg-accent rounded h-full transition-all" style={{ width: `${(d.cost / maxCost) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
