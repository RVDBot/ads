import { useState, useEffect } from 'react'

export function useSyncRefresh() {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const handler = () => setRev(r => r + 1)
    window.addEventListener('sync-complete', handler)
    return () => window.removeEventListener('sync-complete', handler)
  }, [])
  return rev
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login'
  }
  return res
}
