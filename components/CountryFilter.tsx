'use client'

const countries = [
  { code: '', label: 'Alle' },
  { code: 'nl', label: '🇳🇱' },
  { code: 'de', label: '🇩🇪' },
  { code: 'fr', label: '🇫🇷' },
  { code: 'es', label: '🇪🇸' },
  { code: 'it', label: '🇮🇹' },
]

interface CountryFilterProps {
  value: string
  onChange: (country: string) => void
}

export default function CountryFilter({ value, onChange }: CountryFilterProps) {
  return (
    <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
      {countries.map(c => (
        <button key={c.code} onClick={() => onChange(c.code)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
            value === c.code ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
          }`}>
          {c.label}
        </button>
      ))}
    </div>
  )
}
