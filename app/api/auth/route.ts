import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { hashPassword, verifyPassword, isPasswordSet, createSession, validateSession, clearSession } from '@/lib/auth'

const LOGIN_WINDOW_MS = 60_000
const MAX_LOGIN_ATTEMPTS = 5
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
    return false
  }
  entry.count++
  return entry.count > MAX_LOGIN_ATTEMPTS
}

function getSessionCookieOptions(req: NextRequest) {
  const isSecure = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 30,
  }
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value || ''
  return NextResponse.json({
    needsSetup: !isPasswordSet(),
    authenticated: validateSession(sessionToken),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, password } = body

  if (action === 'logout') {
    clearSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', '', { path: '/', maxAge: 0 })
    return res
  }

  if (action === 'change-password') {
    const sessionToken = req.cookies.get('session')?.value || ''
    if (!validateSession(sessionToken)) {
      return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    }
    const { currentPassword, newPassword } = body
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Huidig en nieuw wachtwoord zijn verplicht' }, { status: 400 })
    }
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password_hash') as { value: string } | undefined
    if (!row || !verifyPassword(currentPassword, row.value)) {
      return NextResponse.json({ error: 'Huidig wachtwoord is onjuist' }, { status: 401 })
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' }, { status: 400 })
    }
    const hash = hashPassword(newPassword)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run('auth_password_hash', hash, hash)
    const token = createSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', token, getSessionCookieOptions(req))
    return res
  }

  if (action === 'setup') {
    if (isPasswordSet()) {
      return NextResponse.json({ error: 'Wachtwoord is al ingesteld' }, { status: 400 })
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' }, { status: 400 })
    }
    const db = getDb()
    const hash = hashPassword(password)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run('auth_password_hash', hash, hash)
    const token = createSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', token, getSessionCookieOptions(req))
    return res
  }

  if (action === 'login') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Te veel inlogpogingen. Probeer het over een minuut opnieuw.' }, { status: 429 })
    }
    if (!isPasswordSet()) {
      return NextResponse.json({ error: 'Stel eerst een wachtwoord in' }, { status: 400 })
    }
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password_hash') as { value: string } | undefined
    if (!row || !verifyPassword(password, row.value)) {
      return NextResponse.json({ error: 'Onjuist wachtwoord' }, { status: 401 })
    }
    const token = createSession()
    const res = NextResponse.json({ ok: true })
    res.cookies.set('session', token, getSessionCookieOptions(req))
    return res
  }

  return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
}
