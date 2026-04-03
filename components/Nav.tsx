'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

const tabs = [
  { label: 'Dashboard', href: '/' },
  { label: 'Campagnes', href: '/campaigns' },
  { label: 'Producten', href: '/products' },
  { label: 'Zoekwoorden', href: '/keywords' },
  { label: 'AI Inzichten', href: '/insights' },
  { label: 'Actie Log', href: '/actions' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins} min geleden`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} uur geleden`
  const days = Math.floor(hours / 24)
  return `${days} dag${days > 1 ? 'en' : ''} geleden`
}

export default function Nav() {
  const pathname = usePathname()
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/sync')
      .then(r => r.json())
      .then(d => { if (d.lastSyncAt) setLastSync(d.lastSyncAt) })
      .catch(() => {})
  }, [])

  // Update "x min geleden" every 30 seconds
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await apiFetch('/api/sync', { method: 'POST' })
      // Refresh sync status
      const r = await apiFetch('/api/sync')
      const d = await r.json()
      if (d.lastSyncAt) setLastSync(d.lastSyncAt)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <nav className="sticky top-0 z-40 bg-surface-0/80 backdrop-blur-xl border-b border-border-subtle px-6">
      <div className="max-w-[1200px] mx-auto flex items-center h-14 gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-[15px] text-text-primary">
          <div className="w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-white text-sm">⚡</div>
          Ads Optimizer
        </Link>

        <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5 ml-4">
          {tabs.map(tab => {
            const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
            return (
              <Link key={tab.href} href={tab.href}
                className={`px-3.5 py-1.5 text-[12px] font-medium rounded-md transition-all duration-150 ${
                  active
                    ? 'bg-surface-3 text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {tab.label}
              </Link>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary">
            Laatste sync: {lastSync ? timeAgo(lastSync) : '—'}
          </span>
          <button onClick={handleSync} disabled={syncing}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors">
            {syncing ? 'Syncing...' : 'Sync nu'}
          </button>
          <Link href="/settings" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-2 text-text-tertiary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </Link>
        </div>
      </div>
    </nav>
  )
}
