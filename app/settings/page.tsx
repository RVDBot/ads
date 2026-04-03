'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import LogViewer from '@/components/LogViewer'

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface TokenUsage {
  total: { input: number; output: number }
  last7d: { input: number; output: number }
  last30d: { input: number; output: number }
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`}
    />
  )
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const SECRET_KEYS = [
  'google_ads_developer_token',
  'google_ads_client_secret',
  'google_ads_refresh_token',
  'anthropic_api_key',
]

// -------------------------------------------------------------------
// Section wrapper
// -------------------------------------------------------------------

function Section({
  title,
  ok,
  defaultOpen,
  children,
}: {
  title: string
  ok?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)

  return (
    <div className="bg-surface-1 rounded-2xl border border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-5 py-4 text-left"
      >
        <ChevronIcon open={open} />
        <span className="text-[14px] font-semibold text-text-primary flex-1">
          {title}
        </span>
        {ok !== undefined && <StatusDot ok={ok} />}
      </button>
      {open && <div className="px-5 pb-5 pt-0">{children}</div>}
    </div>
  )
}

// -------------------------------------------------------------------
// Field components
// -------------------------------------------------------------------

const inputClass =
  'w-full bg-surface-0 text-text-primary text-[13px] px-3 py-2.5 rounded-xl outline-none border border-border hover:border-text-tertiary focus:border-accent placeholder:text-text-tertiary transition-colors duration-150'
const labelClass =
  'text-text-tertiary text-[11px] font-semibold uppercase tracking-wider'
const btnClass =
  'w-full mt-4 bg-accent text-white text-[13px] font-semibold py-2.5 rounded-xl hover:bg-accent/90 transition-colors duration-150 disabled:opacity-50'

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  )
}

// -------------------------------------------------------------------
// SaveButton
// -------------------------------------------------------------------

function SaveButton({
  onClick,
  saving,
  saved,
}: {
  onClick: () => void
  saving: boolean
  saved: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={btnClass}
    >
      {saving ? 'Opslaan...' : saved ? 'Opgeslagen!' : 'Opslaan'}
    </button>
  )
}

// -------------------------------------------------------------------
// useSectionForm hook
// -------------------------------------------------------------------

function useSectionForm(
  keys: string[],
  settings: Record<string, string | boolean>,
  saveFn: (key: string, value: string) => Promise<void>,
) {
  const [local, setLocal] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Initialize local state from settings
  useEffect(() => {
    const init: Record<string, string> = {}
    for (const key of keys) {
      if (SECRET_KEYS.includes(key)) {
        init[key] = ''
      } else {
        init[key] = String(settings[key] || '')
      }
    }
    setLocal(init)
  }, [settings, keys.join(',')])

  const update = useCallback((key: string, value: string) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }, [])

  const saveAll = useCallback(async () => {
    setSaving(true)
    for (const key of keys) {
      const val = local[key]
      // Skip empty secret fields (user didn't change them)
      if (SECRET_KEYS.includes(key) && !val) continue
      // Skip non-secret fields that haven't changed
      if (!SECRET_KEYS.includes(key) && val === String(settings[key] || '')) continue
      await saveFn(key, val)
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [keys, local, settings, saveFn])

  return { local, update, saveAll, saving, saved }
}

// -------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({})
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/settings').then((r) => r.json()),
      apiFetch('/api/token-usage').then((r) => r.json()),
    ]).then(([s, t]) => {
      setSettings(s)
      setTokenUsage(t)
      setLoading(false)
    })
  }, [])

  const save = useCallback(
    async (key: string, value: string) => {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (res.ok) {
        setSettings((prev) => {
          const next = { ...prev }
          if (key === 'password') return next
          if (SECRET_KEYS.includes(key)) {
            next[`has_${key}`] = !!value
          } else {
            next[key] = value
          }
          return next
        })
      }
    },
    []
  )

  // Section forms
  const googleAdsKeys = [
    'google_ads_developer_token', 'google_ads_client_id', 'google_ads_client_secret',
    'google_ads_refresh_token', 'google_ads_customer_id', 'google_ads_mcc_id',
  ]
  const merchantKeys = ['com', 'nl', 'de', 'fr', 'es', 'it'].map((d) => `merchant_center_id_${d}`)
  const ga4Keys = ['com', 'nl', 'de', 'fr', 'es', 'it'].map((d) => `ga4_property_id_${d}`)
  const aiKeys = ['anthropic_api_key', 'ai_model', 'ai_analysis_frequency', 'ai_autonomy_level']
  const syncKeys = ['sync_frequency']
  const safetyKeys = ['safety_max_budget_change_day', 'safety_max_percent_change']

  const googleAds = useSectionForm(googleAdsKeys, settings, save)
  const merchant = useSectionForm(merchantKeys, settings, save)
  const ga4 = useSectionForm(ga4Keys, settings, save)
  const ai = useSectionForm(aiKeys, settings, save)
  const sync = useSectionForm(syncKeys, settings, save)
  const safety = useSectionForm(safetyKeys, settings, save)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const hasGoogleAds =
    !!settings.has_google_ads_developer_token &&
    !!settings.google_ads_client_id &&
    !!settings.has_google_ads_client_secret &&
    !!settings.has_google_ads_refresh_token &&
    !!settings.google_ads_customer_id

  const hasMerchant = ['com', 'nl', 'de', 'fr', 'es', 'it'].some((d) => !!settings[`merchant_center_id_${d}`])
  const hasGA4 = ['com', 'nl', 'de', 'fr', 'es', 'it'].some((d) => !!settings[`ga4_property_id_${d}`])
  const hasAI = !!settings.has_anthropic_api_key

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-[680px] mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <a
            href="/"
            className="text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          <h1 className="text-[18px] font-bold text-text-primary flex-1">
            Instellingen
          </h1>
          <span className="text-text-tertiary text-[11px]">
            v{process.env.NEXT_PUBLIC_GIT_HASH || 'dev'}
          </span>
        </div>

        <div className="space-y-3">
          {/* Google Ads */}
          <Section title="Google Ads" ok={hasGoogleAds}>
            <div className="space-y-3">
              <FieldRow label="Developer Token">
                <input
                  type="password"
                  value={googleAds.local.google_ads_developer_token || ''}
                  placeholder={settings.has_google_ads_developer_token ? '••••••••' : ''}
                  onChange={(e) => googleAds.update('google_ads_developer_token', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Client ID">
                <input
                  type="text"
                  value={googleAds.local.google_ads_client_id || ''}
                  placeholder="xxxxxx.apps.googleusercontent.com"
                  onChange={(e) => googleAds.update('google_ads_client_id', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Client Secret">
                <input
                  type="password"
                  value={googleAds.local.google_ads_client_secret || ''}
                  placeholder={settings.has_google_ads_client_secret ? '••••••••' : ''}
                  onChange={(e) => googleAds.update('google_ads_client_secret', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Refresh Token">
                <input
                  type="password"
                  value={googleAds.local.google_ads_refresh_token || ''}
                  placeholder={settings.has_google_ads_refresh_token ? '••••••••' : ''}
                  onChange={(e) => googleAds.update('google_ads_refresh_token', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Customer ID">
                <input
                  type="text"
                  value={googleAds.local.google_ads_customer_id || ''}
                  placeholder="123-456-7890"
                  onChange={(e) => googleAds.update('google_ads_customer_id', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="MCC ID (optioneel)">
                <input
                  type="text"
                  value={googleAds.local.google_ads_mcc_id || ''}
                  placeholder="123-456-7890"
                  onChange={(e) => googleAds.update('google_ads_mcc_id', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <SaveButton onClick={googleAds.saveAll} saving={googleAds.saving} saved={googleAds.saved} />
            </div>
          </Section>

          {/* Merchant Center */}
          <Section title="Merchant Center" ok={hasMerchant}>
            <div className="space-y-3">
              {(['com', 'nl', 'de', 'fr', 'es', 'it'] as const).map((domain) => (
                <FieldRow key={domain} label={`Merchant ID — .${domain}`}>
                  <input
                    type="text"
                    value={merchant.local[`merchant_center_id_${domain}`] || ''}
                    placeholder="123456789"
                    onChange={(e) => merchant.update(`merchant_center_id_${domain}`, e.target.value)}
                    className={inputClass}
                  />
                </FieldRow>
              ))}
              <SaveButton onClick={merchant.saveAll} saving={merchant.saving} saved={merchant.saved} />
            </div>
          </Section>

          {/* GA4 */}
          <Section title="GA4" ok={hasGA4}>
            <div className="space-y-3">
              {(['com', 'nl', 'de', 'fr', 'es', 'it'] as const).map((domain) => (
                <FieldRow key={domain} label={`GA4 Property ID — .${domain}`}>
                  <input
                    type="text"
                    value={ga4.local[`ga4_property_id_${domain}`] || ''}
                    placeholder="123456789"
                    onChange={(e) => ga4.update(`ga4_property_id_${domain}`, e.target.value)}
                    className={inputClass}
                  />
                </FieldRow>
              ))}
              <SaveButton onClick={ga4.saveAll} saving={ga4.saving} saved={ga4.saved} />
            </div>
          </Section>

          {/* AI Config */}
          <Section title="AI Configuratie" ok={hasAI}>
            <div className="space-y-3">
              <FieldRow label="Anthropic API Key">
                <input
                  type="password"
                  value={ai.local.anthropic_api_key || ''}
                  placeholder={settings.has_anthropic_api_key ? '••••••••' : ''}
                  onChange={(e) => ai.update('anthropic_api_key', e.target.value)}
                  className={inputClass}
                />
              </FieldRow>
              <FieldRow label="Model">
                <select
                  value={ai.local.ai_model || 'claude-sonnet-4-6'}
                  onChange={(e) => ai.update('ai_model', e.target.value)}
                  className={inputClass}
                >
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                </select>
              </FieldRow>
              <FieldRow label="Analyse Frequentie">
                <select
                  value={ai.local.ai_analysis_frequency || 'manual'}
                  onChange={(e) => ai.update('ai_analysis_frequency', e.target.value)}
                  className={inputClass}
                >
                  <option value="manual">Handmatig</option>
                  <option value="daily">1x per dag</option>
                  <option value="after_sync">Na elke sync</option>
                </select>
              </FieldRow>
              <FieldRow label="Autonomie Niveau">
                <select
                  value={ai.local.ai_autonomy_level || 'manual'}
                  onChange={(e) => ai.update('ai_autonomy_level', e.target.value)}
                  className={inputClass}
                >
                  <option value="manual">Handmatig</option>
                  <option value="semi">Semi-autonoom</option>
                  <option value="full">Volledig autonoom</option>
                </select>
              </FieldRow>
              <SaveButton onClick={ai.saveAll} saving={ai.saving} saved={ai.saved} />
            </div>
          </Section>

          {/* Sync */}
          <Section title="Sync">
            <div className="space-y-3">
              <FieldRow label="Sync Frequentie">
                <select
                  value={sync.local.sync_frequency || 'daily'}
                  onChange={(e) => sync.update('sync_frequency', e.target.value)}
                  className={inputClass}
                >
                  <option value="daily">1x per dag</option>
                  <option value="4x_daily">4x per dag</option>
                  <option value="manual">Alleen handmatig</option>
                </select>
              </FieldRow>
              <SaveButton onClick={sync.saveAll} saving={sync.saving} saved={sync.saved} />
            </div>
          </Section>

          {/* Safety Limits */}
          <Section title="Veiligheidslimieten">
            <div className="space-y-3">
              <FieldRow label="Max budgetwijziging per dag">
                <div className="relative">
                  <input
                    type="number"
                    value={safety.local.safety_max_budget_change_day || ''}
                    placeholder="50"
                    onChange={(e) => safety.update('safety_max_budget_change_day', e.target.value)}
                    className={inputClass + ' pr-8'}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-[12px]">
                    {'\u20AC'}
                  </span>
                </div>
              </FieldRow>
              <FieldRow label="Max % wijziging per actie">
                <div className="relative">
                  <input
                    type="number"
                    value={safety.local.safety_max_percent_change || ''}
                    placeholder="20"
                    onChange={(e) => safety.update('safety_max_percent_change', e.target.value)}
                    className={inputClass + ' pr-8'}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-[12px]">
                    %
                  </span>
                </div>
              </FieldRow>
              <SaveButton onClick={safety.saveAll} saving={safety.saving} saved={safety.saved} />
            </div>
          </Section>

          {/* Token Usage */}
          <Section title="Token Gebruik">
            {tokenUsage && (
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Totaal', tokenUsage.total],
                    ['Laatste 7 dagen', tokenUsage.last7d],
                    ['Laatste 30 dagen', tokenUsage.last30d],
                  ] as [string, { input: number; output: number }][]
                ).map(([label, data]) => (
                  <div
                    key={label}
                    className="bg-surface-0 rounded-xl p-3 border border-border-subtle"
                  >
                    <div className="text-text-tertiary text-[11px] font-medium mb-2">
                      {label}
                    </div>
                    <div className="text-text-primary text-[14px] font-semibold">
                      {formatTokens(data.input + data.output)}
                    </div>
                    <div className="text-text-tertiary text-[11px] mt-0.5">
                      In: {formatTokens(data.input)} / Out:{' '}
                      {formatTokens(data.output)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Log Viewer */}
          <Section title="Logboek" defaultOpen>
            <LogViewer />
          </Section>
        </div>

        <div className="mt-6 text-center text-text-tertiary text-[11px]">
          Ads Optimizer v{process.env.NEXT_PUBLIC_GIT_HASH || 'dev'}
        </div>
      </div>
    </div>
  )
}
