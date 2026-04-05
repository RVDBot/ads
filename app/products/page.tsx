'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/Nav'
import CountryFilter from '@/components/CountryFilter'
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

const marginColors: Record<string, string> = {
  high: 'bg-success-subtle text-success',
  medium: 'bg-accent-subtle text-accent',
  low: 'bg-warning-subtle text-warning',
}

const statusColors: Record<string, string> = {
  approved: 'bg-success-subtle text-success',
  disapproved: 'bg-danger-subtle text-danger',
  pending: 'bg-warning-subtle text-warning',
}

export default function ProductsPage() {
  const [country, setCountry] = useState('')
  const [marginFilter, setMarginFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const syncRev = useSyncRefresh()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (country) params.set('country', country)
    if (marginFilter) params.set('margin', marginFilter)
    if (statusFilter) params.set('status', statusFilter)
    apiFetch(`/api/products?${params}`)
      .then(r => r.json())
      .then(d => { setProducts(d.products || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [country, marginFilter, statusFilter, syncRev])

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-[16px] font-semibold text-text-primary">Producten</h1>
          <div className="flex items-center gap-2">
            <CountryFilter value={country} onChange={setCountry} />
          </div>
        </div>

        {/* Margin + Status filters */}
        <div className="flex items-center gap-3 mb-4">
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
            {products.length} product{products.length !== 1 ? 'en' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-surface-1 border border-border-subtle rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-8 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
            </div>
          ) : products.length === 0 ? (
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
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Land</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Feed status</th>
                  <th className="text-left text-[11px] font-medium text-text-tertiary px-4 py-2.5">Beschikbaarheid</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id}
                    className={`border-b border-border-subtle transition-colors ${
                      i % 2 === 0 ? 'bg-surface-1' : 'bg-surface-0/50'
                    } hover:bg-surface-hover animate-row`}
                    style={{ animationDelay: `${i * 20}ms` }}>
                    <td className="px-4 py-2.5 text-[13px] text-text-primary max-w-[350px] truncate">{p.title}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right font-medium text-text-primary">
                      {p.price ? formatCurrency(p.price, p.currency || 'EUR') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.margin_label ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${marginColors[p.margin_label] || 'bg-surface-3 text-text-tertiary'}`}>
                          {p.margin_label}
                        </span>
                      ) : <span className="text-[11px] text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">{p.country ? countryFlag(p.country) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusColors[p.status] || 'bg-surface-3 text-text-tertiary'}`}>
                        {p.status || 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-text-secondary">{p.availability || '—'}</td>
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
