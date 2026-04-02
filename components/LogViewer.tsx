'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface LogEntry {
  id: number
  level: string
  category: string
  message: string
  meta: string | null
  created_at: string
}

const LEVEL_STYLES: Record<string, string> = {
  info: 'bg-accent-subtle text-accent',
  warn: 'bg-warning-subtle text-warning',
  error: 'bg-danger-subtle text-danger',
}

const LEVELS = ['all', 'info', 'warn', 'error']
const CATEGORIES = ['all', 'sync', 'ai', 'google-ads', 'merchant', 'ga4', 'system']

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [level, setLevel] = useState('all')
  const [category, setCategory] = useState('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchLogs = useCallback(
    async (offset = 0, append = false) => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (level !== 'all') params.set('level', level)
        if (category !== 'all') params.set('category', category)
        params.set('limit', '100')
        params.set('offset', String(offset))

        const res = await apiFetch(`/api/logs?${params}`)
        if (!res.ok) return
        const data = await res.json()
        setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs))
        setTotal(data.total)
      } finally {
        setLoading(false)
      }
    },
    [level, category]
  )

  useEffect(() => {
    fetchLogs(0, false)
  }, [fetchLogs])

  function formatTime(dt: string) {
    const d = new Date(dt + 'Z')
    return d.toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const selectClass =
    'bg-surface-0 text-text-secondary text-[12px] px-2.5 py-1.5 rounded-lg border border-border outline-none focus:border-accent transition-colors'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className={selectClass}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'Alle niveaus' : l}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={selectClass}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'Alle categorieën' : c}
            </option>
          ))}
        </select>
        <span className="text-text-tertiary text-[12px] ml-auto">
          {total} resultaten
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-surface-2 text-text-tertiary text-left">
              <th className="px-3 py-2 font-medium">Tijd</th>
              <th className="px-3 py-2 font-medium">Niveau</th>
              <th className="px-3 py-2 font-medium">Categorie</th>
              <th className="px-3 py-2 font-medium">Bericht</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((entry) => (
              <tr key={entry.id} className="group">
                <td colSpan={4} className="p-0">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(expandedId === entry.id ? null : entry.id)
                    }
                    className="w-full text-left grid grid-cols-[120px_70px_90px_1fr] items-center hover:bg-surface-hover transition-colors"
                  >
                    <span className="px-3 py-2 text-text-tertiary whitespace-nowrap">
                      {formatTime(entry.created_at)}
                    </span>
                    <span className="px-3 py-2">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${LEVEL_STYLES[entry.level] || ''}`}
                      >
                        {entry.level}
                      </span>
                    </span>
                    <span className="px-3 py-2 text-text-secondary">
                      {entry.category}
                    </span>
                    <span className="px-3 py-2 text-text-primary truncate">
                      {entry.message}
                    </span>
                  </button>
                  {expandedId === entry.id && entry.meta && (
                    <div className="px-3 pb-3">
                      <pre className="bg-surface-0 text-text-secondary text-[11px] p-3 rounded-lg overflow-x-auto border border-border-subtle">
                        {JSON.stringify(JSON.parse(entry.meta), null, 2)}
                      </pre>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-text-tertiary">
                  Geen logregels gevonden
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {logs.length < total && (
        <button
          type="button"
          onClick={() => fetchLogs(logs.length, true)}
          disabled={loading}
          className="w-full py-2 text-[12px] text-accent font-medium hover:bg-accent-subtle rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Laden...' : 'Meer laden'}
        </button>
      )}
    </div>
  )
}
