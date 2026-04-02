import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from './auth'

export function requireAuth(req: NextRequest): NextResponse | null {
  const token = req.cookies.get('session')?.value || ''
  if (!validateSession(token)) {
    return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  }
  return null
}
