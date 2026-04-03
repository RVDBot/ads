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

function Toast({ visible }: { visible: boolean }) {
  return (
    <span
      className={`text-[11px] text-success font-medium transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      Opgeslagen
    </span>
  )
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

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
// Main component
// -------------------------------------------------------------------

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string | boolean>>({})
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch settings + token usage
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

  // Save helper
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
          // For secret keys, update the has_ flag
          if (key === 'password') return next
          if (
            [
              'google_ads_developer_token',
              'google_ads_client_secret',
              'google_ads_refresh_token',
              'anthropic_api_key',
            ].includes(key)
          ) {
            next[`has_${key}`] = !!value
          } else {
            next[key] = value
          }
          return next
        })
        setSavedKey(key)
        setTimeout(() => setSavedKey(null), 1500)
      }
    },
    []
  )

  // Text input that saves on blur
  function TextInput({
    settingKey,
    placeholder,
    type = 'text',
  }: {
    settingKey: string
    placeholder?: string
    type?: string
  }) {
    const isSecret = [
      'google_ads_developer_token',
      'google_ads_client_secret',
      'google_ads_refresh_token',
      'anthropic_api_key',
    ].includes(settingKey)
    const hasKey = `has_${settingKey}`
    const currentValue = isSecret ? '' : String(settings[settingKey] || '')
    const [local, setLocal] = useState(currentValue)
    const [focused, setFocused] = useState(false)

    // Sync from parent when settings load (but not for secrets)
    useEffect(() => {
      if (!isSecret) setLocal(String(settings[settingKey] || ''))
    }, [settings[settingKey], isSecret, settingKey])

    return (
      <div className="flex items-center gap-2">
        <input
          type={type}
          value={focused ? local : (isSecret ? '' : local)}
          placeholder={
            isSecret && settings[hasKey]
              ? '••••••••'
              : placeholder
          }
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (local && (isSecret || local !== currentValue)) {
              save(settingKey, local)
              if (isSecret) setLocal('')
            }
          }}
          className={inputClass}
        />
        <Toast visible={savedKey === settingKey} />
      </div>
    )
  }

  // Select that saves on change
  function SelectInput({
    settingKey,
    options,
  }: {
    settingKey: string
    options: { value: string; label: string }[]
  }) {
    const current = String(settings[settingKey] || options[0]?.value || '')

    return (
      <div className="flex items-center gap-2">
        <select
          value={current}
          onChange={(e) => save(settingKey, e.target.value)}
          className={inputClass}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Toast visible={savedKey === settingKey} />
      </div>
    )
  }

  // Number input that saves on blur
  function NumberInput({
    settingKey,
    placeholder,
    suffix,
  }: {
    settingKey: string
    placeholder?: string
    suffix?: string
  }) {
    const currentValue = String(settings[settingKey] || '')
    const [local, setLocal] = useState(currentValue)

    useEffect(() => {
      setLocal(String(settings[settingKey] || ''))
    }, [settings[settingKey], settingKey])

    return (
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            value={local}
            placeholder={placeholder}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              if (local !== currentValue) save(settingKey, local)
            }}
            className={inputClass + (suffix ? ' pr-8' : '')}
          />
          {suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary text-[12px]">
              {suffix}
            </span>
          )}
        </div>
        <Toast visible={savedKey === settingKey} />
      </div>
    )
  }

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
          <h1 className="text-[18px] font-bold text-text-primary">
            Instellingen
          </h1>
        </div>

        <div className="space-y-3">
          {/* Google Ads */}
          <Section title="Google Ads" ok={hasGoogleAds}>
            <div className="space-y-3">
              <FieldRow label="Developer Token">
                <TextInput
                  settingKey="google_ads_developer_token"
                  type="password"
                />
              </FieldRow>
              <FieldRow label="Client ID">
                <TextInput
                  settingKey="google_ads_client_id"
                  placeholder="xxxxxx.apps.googleusercontent.com"
                />
              </FieldRow>
              <FieldRow label="Client Secret">
                <TextInput
                  settingKey="google_ads_client_secret"
                  type="password"
                />
              </FieldRow>
              <FieldRow label="Refresh Token">
                <TextInput
                  settingKey="google_ads_refresh_token"
                  type="password"
                />
              </FieldRow>
              <FieldRow label="Customer ID">
                <TextInput
                  settingKey="google_ads_customer_id"
                  placeholder="123-456-7890"
                />
              </FieldRow>
              <FieldRow label="MCC ID (optioneel)">
                <TextInput
                  settingKey="google_ads_mcc_id"
                  placeholder="123-456-7890"
                />
              </FieldRow>
            </div>
          </Section>

          {/* Merchant Center */}
          <Section title="Merchant Center" ok={hasMerchant}>
            <div className="space-y-3">
              {(['com', 'nl', 'de', 'fr', 'es', 'it'] as const).map((domain) => (
                <FieldRow key={domain} label={`Merchant ID — .${domain}`}>
                  <TextInput
                    settingKey={`merchant_center_id_${domain}`}
                    placeholder="123456789"
                  />
                </FieldRow>
              ))}
            </div>
          </Section>

          {/* GA4 */}
          <Section title="GA4" ok={hasGA4}>
            <div className="space-y-3">
              {(['com', 'nl', 'de', 'fr', 'es', 'it'] as const).map((domain) => (
                <FieldRow key={domain} label={`GA4 Property ID — .${domain}`}>
                  <TextInput
                    settingKey={`ga4_property_id_${domain}`}
                    placeholder="123456789"
                  />
                </FieldRow>
              ))}
            </div>
          </Section>

          {/* AI Config */}
          <Section title="AI Configuratie" ok={hasAI}>
            <div className="space-y-3">
              <FieldRow label="Anthropic API Key">
                <TextInput settingKey="anthropic_api_key" type="password" />
              </FieldRow>
              <FieldRow label="Model">
                <SelectInput
                  settingKey="ai_model"
                  options={[
                    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
                    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
                    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Analyse Frequentie">
                <SelectInput
                  settingKey="ai_analysis_frequency"
                  options={[
                    { value: 'manual', label: 'Handmatig' },
                    { value: 'daily', label: '1x per dag' },
                    { value: 'after_sync', label: 'Na elke sync' },
                  ]}
                />
              </FieldRow>
              <FieldRow label="Autonomie Niveau">
                <SelectInput
                  settingKey="ai_autonomy_level"
                  options={[
                    { value: 'manual', label: 'Handmatig' },
                    { value: 'semi', label: 'Semi-autonoom' },
                    { value: 'full', label: 'Volledig autonoom' },
                  ]}
                />
              </FieldRow>
            </div>
          </Section>

          {/* Sync */}
          <Section title="Sync">
            <FieldRow label="Sync Frequentie">
              <SelectInput
                settingKey="sync_frequency"
                options={[
                  { value: 'daily', label: '1x per dag' },
                  { value: '4x_daily', label: '4x per dag' },
                  { value: 'manual', label: 'Alleen handmatig' },
                ]}
              />
            </FieldRow>
          </Section>

          {/* Safety Limits */}
          <Section title="Veiligheidslimieten">
            <div className="space-y-3">
              <FieldRow label="Max budgetwijziging per dag">
                <NumberInput
                  settingKey="safety_max_budget_change_day"
                  placeholder="50"
                  suffix="\u20AC"
                />
              </FieldRow>
              <FieldRow label="Max % wijziging per actie">
                <NumberInput
                  settingKey="safety_max_percent_change"
                  placeholder="20"
                  suffix="%"
                />
              </FieldRow>
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
