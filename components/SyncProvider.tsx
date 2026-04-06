'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api'

interface SyncState {
  status: 'idle' | 'running' | 'success' | 'partial'
  lastSyncAt: string | null
  lastErrors: string[]
  startSync: () => void
}

const SyncContext = createContext<SyncState>({
  status: 'idle',
  lastSyncAt: null,
  lastErrors: [],
  startSync: () => {},
})

export function useSync() {
  return useContext(SyncContext)
}

export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SyncState['status']>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [lastErrors, setLastErrors] = useState<string[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasRunning = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await apiFetch('/api/sync')
      const d = await r.json()
      const newStatus = d.status || 'idle'
      setStatus(newStatus)
      if (d.lastSyncAt) setLastSyncAt(d.lastSyncAt)
      if (d.lastErrors) setLastErrors(d.lastErrors)

      // Sync just finished — notify all pages
      if (wasRunning.current && newStatus !== 'running') {
        wasRunning.current = false
        window.dispatchEvent(new Event('sync-complete'))
      }
      if (newStatus === 'running') {
        wasRunning.current = true
      }

      return newStatus
    } catch {
      return status
    }
  }, [status])

  // Initial fetch + detect if sync was already running (e.g. after page reload)
  useEffect(() => {
    fetchStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll while running
  useEffect(() => {
    if (status === 'running') {
      if (!pollRef.current) {
        pollRef.current = setInterval(fetchStatus, 3000)
      }
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [status, fetchStatus])

  const startSync = useCallback(async () => {
    if (status === 'running') return
    setStatus('running')
    wasRunning.current = true
    try {
      await apiFetch('/api/sync', { method: 'POST' })
    } catch { /* API fires and forgets, errors are in sync_status */ }
  }, [status])

  return (
    <SyncContext value={{ status, lastSyncAt, lastErrors, startSync }}>
      {children}
    </SyncContext>
  )
}
