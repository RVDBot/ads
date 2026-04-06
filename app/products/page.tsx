'use client'

import { useState, useEffect, useMemo } from 'react'
import Nav from '@/components/Nav'
import { apiFetch, useSyncRefresh } from '@/lib/api'
import { formatCurrency, countryFlag } from '@/lib/utils'

interface Product {
  id: number
  merchant_product_id: string
  title: string
  price: number
  currency: string
  availability: string
  margin_label: string
  country: string
  status: string
}

interface GroupedProduct {
  title: string
  price: number | null
  currency: string
  margin_label: string | null
  availability: string | null
  countries: Record<string, { status: string; availability: string }>
}

const COUNTRIES = ['NL', 'DE', 'FR', 'ES', 'IT', 'EN']

const marginColors: Record<string, string> = {
  high: 'bg-success-subtle text-success',
  medium: 'bg-accent-subtle text-accent',
  low: 'bg-warning-subtle text-warning',
}

const statusDot: Record<string, string> = {
  approved: '#0f9960',
  disapproved: '#dc2626',
  pending: '#d97706',
}

// Extract base product ID from merchant_product_id
// Format: "online:nl:NL:12345" or "shopify_NL_12345_67890" → extract numeric core
function baseProductId(merchantId: string): string {
  // Try "online:xx:XX:ID" format
  const colonParts = merchantId.split(':')
  if (colonParts.length >= 4) return colonParts.slice(3).join(':')
  // Try "shopify_XX_ID_VARIANT" → drop prefix and country
  const underParts = merchantId.split('_')
  if (underParts.length >= 3) return underParts.slice(2).join('_')
  return merchantId
}

function groupProducts(products: Product[]): GroupedProduct[] {
  const map = new Map<string, GroupedProduct>()

  for (const p of products) {
    const key = baseProductId(p.merchant_product_id)
    if (!map.has(key)) {
      map.set(key, {
        title: p.title,
        price: p.price,
        currency: p.currency || 'EUR',
        margin_label: p.margin_label,
        availability: p.availability,
        countries: {},
      })
    }
    const group = map.get(key)!
    const cc = (p.country || '').toUpperCase()
    if (cc) {
      group.countries[cc] = { status: p.status, availability: p.availability }
    }
    // Use first non-null values
    if (!group.price && p.price) group.price = p.price
    if (!group.margin_label && p.margin_label) group.margin_label = p.margin_label
    if (!group.availability && p.availability) group.availability = p.availability
  }

  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title))
}

export default function ProductsPage() {
  const [marginFilter, setMarginFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const syncRev = useSyncRefresh()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (marginFilter) params.set('margin', marginFilter)
    if (statusFilter) params.set('status', statusFilter)
    apiFetch(`/api/products?${params}`)
      .then(r => r.json())
      .then(d => { setProducts(d.products || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [marginFilter, statusFilter, syncRev])

  const grouped = useMemo(() => {
    const groups = groupProducts(products)
    if (!search) return groups
    const q = search.toLowerCase()
    return groups.filter(g => g.title.toLowerCase().includes(q))
  }, [products, search])

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[16px] font-semibold text-text-primary">Producten</h1>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Zoek product..."
            className="px-3 py-1.5 text-[12px] bg-surface-1 border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary w-48 focus:outline-none focus:border-accent"
          />
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle marges' },
              { value: 'high', label: 'Hoog' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Laag' },
            ].map(m => (
              <button key={m.value} onClick={() => setMarginFilter(m.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  marginFilter === m.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle statussen' },
              { value: 'approved', label: 'Goedgekeurd' },
              { value: 'disapproved', label: 'Afgekeurd' },
            ].map(s => (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  statusFilter === s.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-text-tertiary ml-auto">
            {grouped.length} product{grouped.length !== 1 ? 'en' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
            </div>
          ) : grouped.length === 0 ? (
            <div className="p-12 text-center text-text-tertiary text-[13px]">
              Geen producten gevonden. Sync Merchant Center data via Instellingen.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Titel</th>
                  <th className="text-right text-[11px] font-medium text-text-tertiary px-4 py-2.5">Prijs</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Marge</th>
                  {COUNTRIES.map(c => (
                    <th key={c} className="text-center text-[11px] font-medium text-text-tertiary px-2 py-2.5 w-10">
                      {countryFlag(c)}
                    </th>
                  ))}
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Beschikbaarheid</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, i) => (
                  <tr key={i}
                    className={`border-b border-border-subtle transition-colors ${
                      i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                    } hover:bg-surface-hover`}>
                    <td className="px-4 py-2.5 text-[13px] text-text-primary max-w-[300px] truncate" title={g.title}>{g.title}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-medium text-text-primary">
                      {g.price ? formatCurrency(g.price, g.currency) : '\u2014'}
                    </td>
                    <td className="px-4 py-2.5">
                      {g.margin_label ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${marginColors[g.margin_label] || 'bg-surface-3 text-text-tertiary'}`}>
                          {g.margin_label}
                        </span>
                      ) : <span className="text-[11px] text-text-tertiary">\u2014</span>}
                    </td>
                    {COUNTRIES.map(c => {
                      const entry = g.countries[c]
                      if (!entry) return <td key={c} className="text-center px-2 py-2.5"><span className="text-text-tertiary/30">\u2014</span></td>
                      return (
                        <td key={c} className="text-center px-2 py-2.5">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: statusDot[entry.status] || '#8b9098' }}
                            title={`${c}: ${entry.status}`}
                          />
                        </td>
                      )
                    })}
                    <td className="px-4 py-2.5 text-[13px] text-text-secondary">{g.availability || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  )
}
