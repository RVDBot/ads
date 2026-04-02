import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'
import { setSetting } from '@/lib/settings'
import { hashPassword } from '@/lib/auth'
import { log } from '@/lib/logger'

const SECRET_KEYS = [
  'google_ads_developer_token',
  'google_ads_client_secret',
  'google_ads_refresh_token',
  'anthropic_api_key',
]

const ALLOWED_KEYS = [
  'google_ads_developer_token',
  'google_ads_client_id',
  'google_ads_client_secret',
  'google_ads_refresh_token',
  'google_ads_customer_id',
  'google_ads_mcc_id',
  'merchant_center_id',
  'ga4_property_id',
  'anthropic_api_key',
  'ai_model',
  'ai_analysis_frequency',
  'ai_autonomy_level',
  'sync_frequency',
  'safety_max_budget_change_day',
  'safety_max_percent_change',
  'password',
]

export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]

  const settings: Record<string, string | boolean> = {}

  for (const row of rows) {
    // Skip internal keys
    if (row.key === 'auth_password_hash' || row.key === 'auth_session_token') continue

    if (SECRET_KEYS.includes(row.key)) {
      settings[`has_${row.key}`] = !!row.value
    } else {
      settings[row.key] = row.value
    }
  }

  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  let body: { key: string; value: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON' }, { status: 400 })
  }

  const { key, value } = body

  if (!key || typeof key !== 'string' || typeof value !== 'string') {
    return NextResponse.json({ error: 'key en value zijn verplicht' }, { status: 400 })
  }

  if (!ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: `Onbekende instelling: ${key}` }, { status: 400 })
  }

  try {
    if (key === 'password') {
      if (value.length < 8) {
        return NextResponse.json({ error: 'Wachtwoord moet minimaal 8 tekens zijn' }, { status: 400 })
      }
      const hash = hashPassword(value)
      setSetting('auth_password_hash', hash)
      log('info', 'system', 'Wachtwoord gewijzigd via instellingen')
    } else {
      setSetting(key, value)
      log('info', 'system', `Instelling gewijzigd: ${key}`)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    log('error', 'system', `Fout bij opslaan instelling: ${key}`, { error: String(err) })
    return NextResponse.json({ error: 'Opslaan mislukt' }, { status: 500 })
  }
}
