'use client'

interface RoasChartProps {
  data: Array<{ date: string; roas: number; cost: number; value: number }>
}

export default function RoasChart({ data }: RoasChartProps) {
  if (!data.length) return <div className="text-text-tertiary text-[13px] text-center py-8">Geen data</div>

  const maxRoas = Math.max(...data.map(d => d.roas), 1)

  return (
    <div>
      <div className="text-[13px] font-semibold text-text-primary mb-3">ROAS Trend</div>
      <div className="flex items-end gap-1 h-[120px] px-2">
        {data.map((d, i) => {
          const height = (d.roas / maxRoas) * 100
          const opacity = 0.15 + (i / data.length) * 0.85
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${height}%`,
                  backgroundColor: `rgba(0, 111, 255, ${opacity})`,
                  minHeight: d.roas > 0 ? '4px' : '0',
                }}
                title={`${d.date}: ${d.roas.toFixed(1)}x ROAS`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between px-2 mt-1.5">
        {data.map(d => {
          const day = new Date(d.date)
          const label = day.toLocaleDateString('nl-NL', { weekday: 'short' }).slice(0, 2)
          return <span key={d.date} className="text-[10px] text-text-tertiary flex-1 text-center">{label}</span>
        })}
      </div>
    </div>
  )
}
