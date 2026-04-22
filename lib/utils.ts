export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(amount)
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatRoas(value: number): string {
  return `${value.toFixed(1)}x`
}

export function countryFlag(code: string | null | undefined): string {
  if (!code) return '\u{1F310}'
  const lower = code.toLowerCase().trim()
  if (lower === 'com' || lower === 'en') return '\u{1F310}'
  const upper = lower.toUpperCase()
  if (upper.length === 2) {
    return String.fromCodePoint(
      0x1F1E6 + upper.charCodeAt(0) - 65,
      0x1F1E6 + upper.charCodeAt(1) - 65,
    )
  }
  return code
}

export function targetFlags(str: string | null | undefined, fallback?: string | null): string {
  if (str) return str.split(',').map(c => countryFlag(c.trim())).join(' ')
  if (fallback) return countryFlag(fallback)
  return '\u2014'
}

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Onbekend'
  const names: Record<string, string> = { nl: 'Nederland', de: 'Duitsland', fr: 'Frankrijk', es: 'Spanje', it: 'Itali\u00EB', com: 'Internationaal' }
  return names[code.toLowerCase()] || code
}
