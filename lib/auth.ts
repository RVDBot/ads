import crypto from 'crypto'
import { getDb } from './db'

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'))
}

export function isPasswordSet(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password_hash') as { value: string } | undefined
  return !!row?.value
}

export function createSession(): string {
  const token = crypto.randomUUID()
  const db = getDb()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run('auth_session_token', token, token)
  return token
}

export function validateSession(token: string): boolean {
  if (!token) return false
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_session_token') as { value: string } | undefined
  if (!row?.value || token.length !== row.value.length) return false
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(row.value))
}

export function clearSession(): void {
  const db = getDb()
  db.prepare("DELETE FROM settings WHERE key = 'auth_session_token'").run()
}
