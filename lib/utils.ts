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
  const flags: Record<string, string> = { nl: '\u{1F1F3}\u{1F1F1}', de: '\u{1F1E9}\u{1F1EA}', fr: '\u{1F1EB}\u{1F1F7}', es: '\u{1F1EA}\u{1F1F8}', it: '\u{1F1EE}\u{1F1F9}', com: '\u{1F310}' }
  return flags[code.toLowerCase()] || code
}

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Onbekend'
  const names: Record<string, string> = { nl: 'Nederland', de: 'Duitsland', fr: 'Frankrijk', es: 'Spanje', it: 'Itali\u00EB', com: 'Internationaal' }
  return names[code.toLowerCase()] || code
}
