import { getDb } from './db'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogCategory = 'sync' | 'ai' | 'google-ads' | 'merchant' | 'ga4' | 'system'

export function log(level: LogLevel, category: LogCategory, message: string, meta?: Record<string, unknown>) {
  try {
    getDb().prepare(`
      INSERT INTO logs (level, category, message, meta)
      VALUES (?, ?, ?, ?)
    `).run(level, category, message, meta ? JSON.stringify(meta) : null)
  } catch (e) {
    console.error('Logger failed:', e)
  }
}
