# Ads Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-powered Google Ads optimization dashboard that syncs data from Google Ads, Merchant Center and GA4, analyzes it with Claude, and can apply changes back to Google Ads.

**Architecture:** Scheduled sync pulls data from 3 Google APIs into SQLite. Claude AI analyzes the local data and generates structured suggestions. An action engine applies approved changes back via the Google Ads API. Three autonomy levels (manual/semi/full) control what gets auto-applied.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS v4, SQLite (better-sqlite3), Anthropic Claude API, google-ads-api (gRPC), googleapis (Merchant Center, GA4), Docker (node:22-alpine)

**Design spec:** `docs/superpowers/specs/2026-04-02-ads-optimizer-design.md`

**Reference project:** `/Users/ruben/Library/CloudStorage/ProtonDrive-ruben.vandenbussche@proton.me-folder/_Personal/Claude code/stock` — follow its patterns for auth, DB, settings, API routes, Docker, and Ubiquiti design system.

---

## File Structure

```
ads-optimizer/
├── app/
│   ├── layout.tsx                      # Root layout, Plus Jakarta Sans font
│   ├── globals.css                     # Ubiquiti design system (copy from stock)
│   ├── page.tsx                        # Dashboard (main page)
│   ├── campaigns/
│   │   └── page.tsx                    # Campaigns list + detail view
│   ├── products/
│   │   └── page.tsx                    # Merchant Center products
│   ├── keywords/
│   │   └── page.tsx                    # Keywords + search terms
│   ├── insights/
│   │   └── page.tsx                    # AI insights full view
│   ├── actions/
│   │   └── page.tsx                    # Action log
│   ├── settings/
│   │   └── page.tsx                    # Settings + logs
│   ├── login/
│   │   └── page.tsx                    # Login page
│   └── api/
│       ├── auth/route.ts              # Login/logout/setup
│       ├── settings/route.ts          # GET/PUT settings
│       ├── sync/route.ts              # POST trigger sync, GET sync status
│       ├── campaigns/route.ts         # GET campaigns + metrics
│       ├── campaigns/[id]/route.ts    # GET single campaign detail
│       ├── products/route.ts          # GET products from local DB
│       ├── keywords/route.ts          # GET keywords + search terms
│       ├── ai/
│       │   ├── analyze/route.ts       # POST trigger analysis
│       │   └── suggestions/route.ts   # GET/PATCH suggestions
│       ├── actions/
│       │   ├── apply/route.ts         # POST apply a suggestion
│       │   └── log/route.ts           # GET action log
│       ├── shop-profile/route.ts      # GET/POST shop profile
│       ├── token-usage/route.ts       # GET token stats
│       └── logs/route.ts             # GET technical logs
├── components/
│   ├── Nav.tsx                        # Top navigation bar
│   ├── KpiCard.tsx                    # Reusable KPI stat card
│   ├── CountryFilter.tsx              # Country filter pills
│   ├── PeriodFilter.tsx               # Period dropdown
│   ├── RoasChart.tsx                  # ROAS trend bar chart
│   ├── CountryBreakdown.tsx           # Spend per country bars
│   ├── InsightCard.tsx                # Single AI insight with apply button
│   ├── CampaignRow.tsx               # Campaign list row
│   ├── SuggestionCard.tsx            # Full suggestion with details
│   └── LogViewer.tsx                  # Technical log viewer
├── lib/
│   ├── db.ts                          # SQLite singleton + schema + migrations
│   ├── auth.ts                        # Password hashing, session management
│   ├── auth-guard.ts                  # requireAuth() for API routes
│   ├── api.ts                         # apiFetch() client helper
│   ├── settings.ts                    # getSetting()/setSetting() helpers
│   ├── logger.ts                      # Structured logging to DB
│   ├── google-ads.ts                  # Google Ads API client + sync
│   ├── merchant-center.ts            # Merchant Center API client + sync
│   ├── ga4.ts                         # GA4 Data API client + sync
│   ├── sync.ts                        # Orchestrates full sync across all sources
│   ├── scheduler.ts                   # Scheduled sync (setTimeout-based)
│   ├── ai-analyzer.ts                # Claude analysis engine
│   ├── action-engine.ts              # Apply suggestions via Google Ads API
│   ├── shop-profile.ts               # Website crawler + profile generator
│   └── utils.ts                       # Shared formatting utilities
├── middleware.ts                       # Auth + CSRF middleware
├── instrumentation.ts                 # Start scheduler on boot
├── next.config.ts                     # Standalone output, security headers
├── tsconfig.json
├── package.json
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh
└── .github/
    └── workflows/
        └── docker.yml                 # Build + push to ghcr.io
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `postcss.config.mjs`, `.gitignore`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/ruben/Library/CloudStorage/ProtonDrive-ruben.vandenbussche@proton.me-folder/_Personal/Claude\ code/ads-optimizer
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm
```

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3 @anthropic-ai/sdk google-ads-api googleapis
npm install -D @types/better-sqlite3
```

- [ ] **Step 3: Configure next.config.ts**

```typescript
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
  },
}

export default nextConfig
```

- [ ] **Step 4: Copy globals.css from stock dashboard**

Copy the Ubiquiti design system CSS from `/Users/ruben/Library/CloudStorage/ProtonDrive-ruben.vandenbussche@proton.me-folder/_Personal/Claude code/stock/app/globals.css` — includes all CSS custom properties (`--color-surface-0` through `--color-danger-subtle`), Plus Jakarta Sans font import, scrollbar styling, skeleton animation, fadeInUp animation. Keep it identical.

- [ ] **Step 5: Update app/layout.tsx**

```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ads Optimizer — SpeedRopeShop',
  description: 'AI-gestuurd Google Ads optimalisatie dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: Create placeholder page**

```typescript
// app/page.tsx
export default function Home() {
  return <div className="min-h-screen bg-surface-0 flex items-center justify-center">
    <p className="text-text-secondary text-[15px]">Ads Optimizer</p>
  </div>
}
```

- [ ] **Step 7: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Project scaffolding: Next.js 15, Tailwind, Ubiquiti design system"
git push
```

---

## Task 2: Database + Auth + Middleware

**Files:**
- Create: `lib/db.ts`, `lib/auth.ts`, `lib/auth-guard.ts`, `lib/api.ts`, `lib/logger.ts`, `lib/settings.ts`, `lib/utils.ts`, `middleware.ts`, `app/login/page.tsx`, `app/api/auth/route.ts`

- [ ] **Step 1: Create lib/db.ts with full schema**

Follow the stock dashboard pattern: singleton `getDb()`, WAL mode, foreign keys ON. Schema includes all tables from the design spec:

```typescript
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), 'data', 'ads-optimizer.db')

const dir = path.dirname(DB_PATH)
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_campaign_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      country TEXT,
      daily_budget REAL,
      bid_strategy TEXT,
      target_roas REAL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      avg_cpc REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, date)
    );

    CREATE TABLE IF NOT EXISTS ad_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      google_adgroup_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adgroup_id INTEGER NOT NULL,
      google_keyword_id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL,
      match_type TEXT NOT NULL,
      bid REAL,
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (adgroup_id) REFERENCES ad_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS keyword_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
      UNIQUE(keyword_id, date)
    );

    CREATE TABLE IF NOT EXISTS search_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      search_term TEXT NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      conversion_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adgroup_id INTEGER NOT NULL,
      google_ad_id TEXT NOT NULL UNIQUE,
      headlines TEXT NOT NULL DEFAULT '[]',
      descriptions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ENABLED',
      FOREIGN KEY (adgroup_id) REFERENCES ad_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ad_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      conversions REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (ad_id) REFERENCES ads(id) ON DELETE CASCADE,
      UNIQUE(ad_id, date)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_product_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      price REAL,
      currency TEXT DEFAULT 'EUR',
      availability TEXT,
      margin_label TEXT,
      country TEXT,
      status TEXT DEFAULT 'approved',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ga4_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_path TEXT NOT NULL,
      date TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      bounce_rate REAL NOT NULL DEFAULT 0,
      avg_session_duration REAL NOT NULL DEFAULT 0,
      pages_per_session REAL NOT NULL DEFAULT 0,
      country TEXT,
      UNIQUE(page_path, date, country)
    );

    CREATE TABLE IF NOT EXISTS shop_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT NOT NULL UNIQUE,
      profile_content TEXT NOT NULL,
      last_crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      findings TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      description TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      applied_at DATETIME,
      result_roas_before REAL,
      result_roas_after REAL,
      FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_id INTEGER,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      applied_by TEXT NOT NULL DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      google_response TEXT,
      FOREIGN KEY (suggestion_id) REFERENCES ai_suggestions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER,
      call_type TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
}
```

- [ ] **Step 2: Create lib/auth.ts, lib/auth-guard.ts, lib/api.ts**

Copy these verbatim from the stock dashboard — same patterns: scrypt password hashing, UUID session tokens, `requireAuth()` guard, `apiFetch()` client helper. Adjust the database name in any references.

- [ ] **Step 3: Create lib/logger.ts**

```typescript
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
```

- [ ] **Step 4: Create lib/settings.ts**

```typescript
import { getDb } from './db'

export function getSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value || ''
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, value, value)
}
```

- [ ] **Step 5: Create middleware.ts**

Copy from stock dashboard — session-based auth with CSRF protection. Public routes: `/login`, `/api/auth`, `/_next`, `/favicon`.

- [ ] **Step 6: Create app/login/page.tsx and app/api/auth/route.ts**

Copy from stock dashboard — login form with setup/login modes, rate limiting (5 attempts/60s per IP), secure cookies.

- [ ] **Step 7: Create lib/utils.ts**

```typescript
export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency }).format(amount)
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatRoas(value: number): string {
  return `${value.toFixed(1)}x`
}

export function countryFlag(code: string): string {
  const flags: Record<string, string> = { nl: '🇳🇱', de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸', it: '🇮🇹', com: '🌐' }
  return flags[code.toLowerCase()] || code
}

export function countryName(code: string): string {
  const names: Record<string, string> = { nl: 'Nederland', de: 'Duitsland', fr: 'Frankrijk', es: 'Spanje', it: 'Italië', com: 'Internationaal' }
  return names[code.toLowerCase()] || code
}
```

- [ ] **Step 8: Verify build**

```bash
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Database schema, auth, middleware, login, logger, settings"
git push
```

---

## Task 3: Settings UI + API

**Files:**
- Create: `app/api/settings/route.ts`, `app/settings/page.tsx`

- [ ] **Step 1: Create settings API route**

Follow stock dashboard pattern. Allowed write keys:
- `google_ads_developer_token`, `google_ads_client_id`, `google_ads_client_secret`, `google_ads_refresh_token`, `google_ads_customer_id`, `google_ads_mcc_id`
- `merchant_center_id`
- `ga4_property_id`
- `anthropic_api_key`, `ai_model`, `ai_analysis_frequency`, `ai_autonomy_level`
- `sync_frequency`
- `safety_max_budget_change_day`, `safety_max_percent_change`
- `password`

Mask secrets in GET response (show `has_*` booleans). PUT validates against whitelist.

- [ ] **Step 2: Create settings page**

Ubiquiti-style settings page with collapsible sections:
1. **Google Ads** — developer token, client ID, client secret, refresh token, customer ID, MCC ID
2. **Merchant Center** — merchant center ID
3. **GA4** — property ID
4. **AI** — Anthropic API key, model select (dropdown: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5), analysis frequency (handmatig/1x per dag/na elke sync), autonomy level (handmatig/semi-autonoom/volledig autonoom)
5. **Sync** — frequency (1x per dag/4x per dag/alleen handmatig)
6. **Veiligheid** — max budget change per day (€), max % change per action
7. **Token Gebruik** — display total input/output tokens (fetched from `/api/token-usage`)
8. **Logboek** — embedded LogViewer component

Follow stock dashboard's settings page structure: `apiFetch`, status indicators (green/red dots), collapsible sections.

- [ ] **Step 3: Create components/LogViewer.tsx**

Table showing logs from `/api/logs`. Filters: level dropdown (all/info/warn/error), category dropdown. Each row: timestamp, level badge (colored), category, message. Click to expand shows full `meta` JSON. Pagination or virtual scroll for performance.

- [ ] **Step 4: Create app/api/logs/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const level = req.nextUrl.searchParams.get('level')
  const category = req.nextUrl.searchParams.get('category')
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)

  const db = getDb()
  let where = 'WHERE 1=1'
  const params: unknown[] = []
  if (level && level !== 'all') { where += ' AND level = ?'; params.push(level) }
  if (category && category !== 'all') { where += ' AND category = ?'; params.push(category) }
  params.push(limit, offset)

  const logs = db.prepare(`SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params)
  const total = (db.prepare(`SELECT COUNT(*) as count FROM logs ${where.replace(/ LIMIT.*/, '')}`).get(...params.slice(0, -2)) as { count: number }).count

  return NextResponse.json({ logs, total })
}
```

- [ ] **Step 5: Create app/api/token-usage/route.ts**

Return aggregated token usage: total, last 7 days, last 30 days.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Settings UI with credentials, AI config, safety limits, log viewer"
git push
```

---

## Task 4: Navigation + Dashboard Layout

**Files:**
- Create: `components/Nav.tsx`, `components/KpiCard.tsx`, `components/CountryFilter.tsx`, `components/PeriodFilter.tsx`, `app/page.tsx`

- [ ] **Step 1: Create components/Nav.tsx**

Frosted glass top navigation bar, identical pattern to stock dashboard Nav.tsx:
- Logo icon (⚡ on accent blue square) + "Ads Optimizer" text
- Tab navigation: Dashboard, Campagnes, Producten, Zoekwoorden, AI Inzichten, Actie Log
- Right side: last sync timestamp + "Sync nu" button + settings gear icon
- Active tab highlighted with `bg-surface-3` + shadow
- Uses Next.js `usePathname()` for active state

```typescript
'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const tabs = [
  { label: 'Dashboard', href: '/' },
  { label: 'Campagnes', href: '/campaigns' },
  { label: 'Producten', href: '/products' },
  { label: 'Zoekwoorden', href: '/keywords' },
  { label: 'AI Inzichten', href: '/insights' },
  { label: 'Actie Log', href: '/actions' },
]

export default function Nav() {
  const pathname = usePathname()
  // ... follow stock Nav.tsx structure exactly
}
```

- [ ] **Step 2: Create reusable components**

`KpiCard.tsx`: label, value, change (with up/down color). `CountryFilter.tsx`: pill buttons for Alle/🇳🇱/🇩🇪/🇫🇷/🇪🇸/🇮🇹 with active state. `PeriodFilter.tsx`: select dropdown (7d/30d/maand).

- [ ] **Step 3: Build dashboard page (app/page.tsx)**

Layout: Nav at top, then max-w-[1200px] centered content. Top bar with title + filters. KPI grid (5 cards). Charts row (ROAS trend + country breakdown). AI insights preview section. Data comes from API routes (empty state for now — "Nog geen data. Configureer je API keys in Instellingen en start een sync.").

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Navigation, dashboard layout, KPI cards, country/period filters"
git push
```

---

## Task 5: Google Ads API Sync

**Files:**
- Create: `lib/google-ads.ts`, `lib/sync.ts`, `lib/scheduler.ts`, `app/api/sync/route.ts`, `instrumentation.ts`

- [ ] **Step 1: Create lib/google-ads.ts**

Google Ads API client using `google-ads-api` package. Functions:
- `getGoogleAdsClient()`: creates authenticated client from settings (developer token, client ID, client secret, refresh token, customer ID)
- `syncCampaigns()`: fetch all campaigns with `CampaignService`, upsert into `campaigns` table
- `syncDailyMetrics(dateRange)`: fetch campaign metrics via GAQL query, upsert into `daily_metrics`
- `syncAdGroups()`: fetch ad groups, upsert into `ad_groups`
- `syncKeywords()`: fetch keywords per ad group, upsert into `keywords`
- `syncKeywordMetrics(dateRange)`: keyword-level metrics into `keyword_metrics`
- `syncSearchTerms(dateRange)`: search terms report into `search_terms`
- `syncAds()`: fetch responsive search ads, upsert into `ads`
- `syncAdMetrics(dateRange)`: ad-level metrics into `ad_metrics`

Each function: fetches from API, uses `db.transaction()` for bulk upserts with `INSERT ... ON CONFLICT ... DO UPDATE`, logs progress and errors.

GAQL query example for campaign metrics:
```typescript
const query = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.advertising_channel_type,
    campaign.status,
    campaign.campaign_budget,
    metrics.cost_micros,
    metrics.clicks,
    metrics.impressions,
    metrics.conversions,
    metrics.conversions_value,
    segments.date
  FROM campaign
  WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  ORDER BY segments.date DESC
`
```

- [ ] **Step 2: Create lib/sync.ts**

Orchestrator that runs all sync functions in sequence:

```typescript
import { log } from './logger'
import { setSetting } from './settings'

export async function runFullSync(trigger: 'manual' | 'scheduled' = 'manual'): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = []
  log('info', 'sync', `Full sync gestart (${trigger})`)
  setSetting('sync_status', 'running')
  setSetting('sync_started_at', new Date().toISOString())

  // 1. Google Ads
  try {
    const { syncCampaigns, syncDailyMetrics, syncAdGroups, syncKeywords, syncKeywordMetrics, syncSearchTerms, syncAds, syncAdMetrics } = await import('./google-ads')
    await syncCampaigns()
    await syncDailyMetrics('LAST_30_DAYS')
    await syncAdGroups()
    await syncKeywords()
    await syncKeywordMetrics('LAST_30_DAYS')
    await syncSearchTerms('LAST_30_DAYS')
    await syncAds()
    await syncAdMetrics('LAST_30_DAYS')
    log('info', 'google-ads', 'Google Ads sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Google Ads: ${msg}`)
    log('error', 'google-ads', 'Google Ads sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  // 2. Merchant Center
  try {
    const { syncProducts } = await import('./merchant-center')
    await syncProducts()
    log('info', 'merchant', 'Merchant Center sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`Merchant Center: ${msg}`)
    log('error', 'merchant', 'Merchant Center sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  // 3. GA4
  try {
    const { syncGA4Pages } = await import('./ga4')
    await syncGA4Pages('30daysAgo')
    log('info', 'ga4', 'GA4 sync voltooid')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`GA4: ${msg}`)
    log('error', 'ga4', 'GA4 sync mislukt', { error: msg, stack: e instanceof Error ? e.stack : undefined })
  }

  const success = errors.length === 0
  setSetting('sync_status', success ? 'success' : 'partial')
  setSetting('last_sync_at', new Date().toISOString())
  setSetting('last_sync_errors', JSON.stringify(errors))
  log(success ? 'info' : 'warn', 'sync', `Full sync ${success ? 'voltooid' : 'met fouten'}`, { errors })
  return { success, errors }
}
```

- [ ] **Step 3: Create lib/scheduler.ts**

Follow stock dashboard pattern: `scheduleSyncs()` called once from instrumentation. Reads `sync_frequency` setting to determine schedule (every 6h for 4x/day, every 24h for 1x/day). Also optionally triggers AI analysis after sync based on `ai_analysis_frequency` setting.

- [ ] **Step 4: Create instrumentation.ts**

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { scheduleSyncs } = await import('@/lib/scheduler')
    scheduleSyncs()
    console.log('[instrumentation] Sync scheduler gestart')
  }
}
```

- [ ] **Step 5: Create app/api/sync/route.ts**

POST: triggers `runFullSync('manual')`, returns result. GET: returns current sync status (last_sync_at, sync_status, last_sync_errors).

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Google Ads API sync, sync orchestrator, scheduler, sync API"
git push
```

---

## Task 6: Merchant Center + GA4 Sync

**Files:**
- Create: `lib/merchant-center.ts`, `lib/ga4.ts`

- [ ] **Step 1: Create lib/merchant-center.ts**

Uses `googleapis` Content API for Shopping v2.1:
- `getMerchantClient()`: auth with OAuth2 credentials from settings
- `syncProducts()`: list all products, upsert into `products` table (merchant_product_id, title, price, currency, availability, margin from customLabel fields, country, status)

```typescript
import { google } from 'googleapis'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

function getAuthClient() {
  return new google.auth.OAuth2(
    getSetting('google_ads_client_id'),
    getSetting('google_ads_client_secret')
  ).setCredentials({ refresh_token: getSetting('google_ads_refresh_token') })
}

export async function syncProducts() {
  const merchantId = getSetting('merchant_center_id')
  if (!merchantId) throw new Error('Merchant Center ID niet geconfigureerd')

  const auth = getAuthClient()
  const content = google.content({ version: 'v2.1', auth })
  const db = getDb()

  let pageToken: string | undefined
  let total = 0

  do {
    const res = await content.products.list({ merchantId, pageToken, maxResults: 250 })
    const products = res.data.resources || []

    const stmt = db.prepare(`
      INSERT INTO products (merchant_product_id, title, price, currency, availability, margin_label, country, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(merchant_product_id) DO UPDATE SET
        title = excluded.title, price = excluded.price, currency = excluded.currency,
        availability = excluded.availability, margin_label = excluded.margin_label,
        country = excluded.country, status = excluded.status, updated_at = CURRENT_TIMESTAMP
    `)

    const tx = db.transaction((items: typeof products) => {
      for (const p of items) {
        const price = p.price ? parseFloat(p.price.value || '0') : null
        const margin = p.customLabel0 || null // margin_label in custom label 0
        const country = p.targetCountry || null
        const status = p.destinations?.[0]?.status || 'approved'
        stmt.run(p.id, p.title, price, p.price?.currency || 'EUR', p.availability, margin, country, status)
      }
    })
    tx(products)
    total += products.length
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  log('info', 'merchant', `${total} producten gesynchroniseerd`)
}
```

- [ ] **Step 2: Create lib/ga4.ts**

Uses `@google-analytics/data` or `googleapis` analyticsdata v1beta:
- `syncGA4Pages(startDate)`: run report for landing page metrics (sessions, bounceRate, avgSessionDuration, screenPageViewsPerSession) segmented by pagePath and country. Upsert into `ga4_pages`.

```typescript
import { google } from 'googleapis'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

export async function syncGA4Pages(startDate: string = '30daysAgo') {
  const propertyId = getSetting('ga4_property_id')
  if (!propertyId) throw new Error('GA4 Property ID niet geconfigureerd')

  const auth = new google.auth.OAuth2(
    getSetting('google_ads_client_id'),
    getSetting('google_ads_client_secret')
  )
  auth.setCredentials({ refresh_token: getSetting('google_ads_refresh_token') })

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth })

  const res = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate: 'today' }],
      dimensions: [
        { name: 'pagePath' },
        { name: 'date' },
        { name: 'country' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'screenPageViewsPerSession' },
      ],
      limit: 10000,
    },
  })

  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO ga4_pages (page_path, date, sessions, bounce_rate, avg_session_duration, pages_per_session, country)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_path, date, country) DO UPDATE SET
      sessions = excluded.sessions, bounce_rate = excluded.bounce_rate,
      avg_session_duration = excluded.avg_session_duration, pages_per_session = excluded.pages_per_session
  `)

  const rows = res.data.rows || []
  const tx = db.transaction(() => {
    for (const row of rows) {
      const dims = row.dimensionValues || []
      const mets = row.metricValues || []
      const date = dims[1]?.value || ''
      const formattedDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`
      stmt.run(
        dims[0]?.value, formattedDate,
        parseInt(mets[0]?.value || '0'),
        parseFloat(mets[1]?.value || '0'),
        parseFloat(mets[2]?.value || '0'),
        parseFloat(mets[3]?.value || '0'),
        dims[2]?.value
      )
    }
  })
  tx()

  log('info', 'ga4', `${rows.length} pagina-rijen gesynchroniseerd`)
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Merchant Center product sync, GA4 landing page sync"
git push
```

---

## Task 7: Dashboard Data API + Charts

**Files:**
- Create: `app/api/campaigns/route.ts`, `components/RoasChart.tsx`, `components/CountryBreakdown.tsx`, `components/InsightCard.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create campaigns API route**

GET returns campaigns with aggregated metrics. Supports query params: `country`, `period` (7/30), `type`. Also returns KPI totals for the dashboard.

```typescript
// app/api/campaigns/route.ts
export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const country = req.nextUrl.searchParams.get('country')
  const period = parseInt(req.nextUrl.searchParams.get('period') || '7', 10)
  const db = getDb()

  // Date range
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - period)
  const startStr = startDate.toISOString().split('T')[0]

  // Previous period for comparison
  const prevStart = new Date()
  prevStart.setDate(prevStart.getDate() - period * 2)
  const prevStartStr = prevStart.toISOString().split('T')[0]

  // Build campaign query with metrics
  let where = 'WHERE dm.date >= ?'
  const params: unknown[] = [startStr]
  if (country) { where += ' AND c.country = ?'; params.push(country) }

  const campaigns = db.prepare(`
    SELECT c.*,
      SUM(dm.cost) as total_cost, SUM(dm.clicks) as total_clicks,
      SUM(dm.impressions) as total_impressions, SUM(dm.conversions) as total_conversions,
      SUM(dm.conversion_value) as total_value,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id ${where.replace('WHERE', 'AND')}
    GROUP BY c.id
    ORDER BY total_cost DESC
  `).all(...params)

  // KPI totals for current period
  const kpi = db.prepare(`
    SELECT SUM(cost) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions, SUM(clicks) as clicks,
      CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas,
      CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as avg_cpc
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= ? ${country ? 'AND c.country = ?' : ''}
  `).get(startStr, ...(country ? [country] : [])) as Record<string, number>

  // Previous period KPIs for comparison
  const prevKpi = db.prepare(`
    SELECT SUM(cost) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions,
      CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas,
      CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as avg_cpc
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= ? AND dm.date < ? ${country ? 'AND c.country = ?' : ''}
  `).get(prevStartStr, startStr, ...(country ? [country] : [])) as Record<string, number>

  // Daily ROAS for chart
  const dailyRoas = db.prepare(`
    SELECT dm.date, SUM(dm.cost) as cost, SUM(dm.conversion_value) as value,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= ? ${country ? 'AND c.country = ?' : ''}
    GROUP BY dm.date ORDER BY dm.date ASC
  `).all(startStr, ...(country ? [country] : []))

  // Spend per country
  const countryBreakdown = db.prepare(`
    SELECT c.country, SUM(dm.cost) as cost, SUM(dm.conversion_value) as value
    FROM daily_metrics dm
    JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= ?
    GROUP BY c.country ORDER BY cost DESC
  `).all(startStr)

  return NextResponse.json({ campaigns, kpi, prevKpi, dailyRoas, countryBreakdown })
}
```

- [ ] **Step 2: Create chart components**

`RoasChart.tsx`: bar chart using CSS (no chart library needed — same pattern as the wireframe). Takes `dailyRoas` array, renders bars with height proportional to ROAS value.

`CountryBreakdown.tsx`: horizontal bar chart showing spend per country with flag emoji + amount.

`InsightCard.tsx`: displays a single AI suggestion with priority badge, title, description, and "Pas toe"/"Negeer" buttons.

- [ ] **Step 3: Wire up dashboard page**

Update `app/page.tsx` to fetch from `/api/campaigns` with selected country/period filters. Show KPI cards with comparison arrows, ROAS chart, country breakdown, and latest AI insights (from `/api/ai/suggestions?limit=3&status=pending`).

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Dashboard with KPIs, ROAS chart, country breakdown, data API"
git push
```

---

## Task 8: Campaigns + Products + Keywords Pages

**Files:**
- Create: `app/campaigns/page.tsx`, `app/api/campaigns/[id]/route.ts`, `app/products/page.tsx`, `app/api/products/route.ts`, `app/keywords/page.tsx`, `app/api/keywords/route.ts`, `components/CampaignRow.tsx`

- [ ] **Step 1: Campaigns page**

List view: table with columns — naam, type badge, land flag, status pill, budget, kosten (period), ROAS, conversies. Click through to campaign detail. Filter bar: country, type (Search/Shopping/PMax), status (active/paused).

Campaign detail (`/api/campaigns/[id]`): returns campaign + daily_metrics + ad_groups + keywords for that campaign. Detail page shows: trend chart, ad groups list, keywords table, search terms.

- [ ] **Step 2: Products page**

Table with: titel, prijs, marge-label (badge), land, feed status (approved/disapproved badge), beschikbaarheid. Data from local `products` table. Filter: country, margin_label, status.

- [ ] **Step 3: Keywords page**

Two tabs: "Zoekwoorden" (from keywords table with metrics) and "Zoekopdrachten" (from search_terms table). Keywords tab: text, match type, bid, kosten, klikken, conversies, ROAS. Search terms tab: zoekterm, kosten, klikken, conversies — with AI suggested negatives highlighted. Verspillers section: keywords/terms with cost > €5 and 0 conversions.

- [ ] **Step 4: Create all API routes**

`/api/products`: GET products with filters. `/api/keywords`: GET keywords + search terms with filters and period.

- [ ] **Step 5: Verify build + commit**

```bash
npm run build
git add -A && git commit -m "Campaigns, products, keywords pages with data tables and filters"
git push
```

---

## Task 9: Shop Profile (Website Crawler)

**Files:**
- Create: `lib/shop-profile.ts`, `app/api/shop-profile/route.ts`

- [ ] **Step 1: Create lib/shop-profile.ts**

Uses `fetch()` to crawl the SpeedRope Shop websites. For each country domain:
- Fetch homepage + a few product pages
- Extract: meta descriptions, product categories, pricing range, USPs, tone of voice
- Send page content to Claude with a prompt to generate a structured shop profile
- Store result in `shop_profile` table

```typescript
import { getSetting } from './settings'
import { getDb } from './db'
import { log } from './logger'
import Anthropic from '@anthropic-ai/sdk'

const DOMAINS: Record<string, string> = {
  nl: 'https://speedropeshop.nl',
  de: 'https://speedropeshop.de',
  fr: 'https://speedropeshop.fr',
  es: 'https://speedropeshop.es',
  it: 'https://speedropeshop.it',
  com: 'https://speedropeshop.com',
}

export async function crawlAndGenerateProfile(country: string): Promise<string> {
  const domain = DOMAINS[country]
  if (!domain) throw new Error(`Onbekend land: ${country}`)

  // Fetch homepage
  const homepageRes = await fetch(domain)
  const homepage = await homepageRes.text()

  // Strip HTML to text (basic)
  const text = homepage.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000) // limit context

  const apiKey = getSetting('anthropic_api_key')
  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Analyseer deze e-commerce website (${domain}) en maak een shop profiel in het Nederlands. Beschrijf:
1. Doelgroep (wie koopt hier?)
2. Productaanbod (wat wordt er verkocht, prijsrange)
3. USPs (unieke verkoopargumenten)
4. Taal en tone of voice (hoe communiceert de shop)
5. Specifieke kenmerken voor dit land/markt

Website content:
${text}

Geef het profiel als gestructureerde markdown.`
    }]
  })

  const profile = (response.content[0] as { text: string }).text.trim()

  // Save to DB
  const db = getDb()
  db.prepare(`
    INSERT INTO shop_profile (country, profile_content, last_crawled_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(country) DO UPDATE SET profile_content = excluded.profile_content, last_crawled_at = CURRENT_TIMESTAMP
  `).run(country, profile)

  // Log token usage
  db.prepare('INSERT INTO token_usage (call_type, input_tokens, output_tokens) VALUES (?, ?, ?)')
    .run('shop_profile', response.usage.input_tokens, response.usage.output_tokens)

  log('info', 'ai', `Shop profiel gegenereerd voor ${country}`, { tokens: response.usage })
  return profile
}

export async function crawlAllProfiles(): Promise<void> {
  for (const country of Object.keys(DOMAINS)) {
    try {
      await crawlAndGenerateProfile(country)
    } catch (e) {
      log('error', 'ai', `Shop profiel mislukt voor ${country}`, { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
```

- [ ] **Step 2: Create shop profile API route**

GET: returns all shop profiles. POST: triggers (re)crawl for specified country or all.

- [ ] **Step 3: Verify build + commit**

```bash
npm run build
git add -A && git commit -m "Shop profile: website crawler + Claude profile generation"
git push
```

---

## Task 10: AI Analysis Engine

**Files:**
- Create: `lib/ai-analyzer.ts`, `app/api/ai/analyze/route.ts`, `app/api/ai/suggestions/route.ts`

- [ ] **Step 1: Create lib/ai-analyzer.ts**

Core analysis engine. Gathers all local data, sends to Claude, parses structured response.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

export async function runAnalysis(): Promise<number> {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')

  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const client = new Anthropic({ apiKey })
  const db = getDb()

  // Gather context
  const campaigns = db.prepare(`
    SELECT c.*,
      SUM(dm.cost) as cost_7d, SUM(dm.conversion_value) as value_7d, SUM(dm.conversions) as conv_7d,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas_7d
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-7 days')
    WHERE c.status = 'ENABLED'
    GROUP BY c.id
  `).all()

  const dailyTrends = db.prepare(`
    SELECT dm.date, c.name, c.country, dm.cost, dm.conversion_value, dm.roas, dm.clicks
    FROM daily_metrics dm JOIN campaigns c ON c.id = dm.campaign_id
    WHERE dm.date >= date('now', '-14 days')
    ORDER BY dm.date DESC
  `).all()

  const topKeywords = db.prepare(`
    SELECT k.text, k.match_type, ag.name as adgroup, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks, SUM(km.conversions) as conversions, SUM(km.conversion_value) as value
    FROM keywords k
    JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-7 days')
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    GROUP BY k.id ORDER BY cost DESC LIMIT 50
  `).all()

  const wastedTerms = db.prepare(`
    SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks, SUM(conversions) as conversions
    FROM search_terms WHERE date >= date('now', '-7 days')
    GROUP BY search_term HAVING SUM(cost) > 2 AND SUM(conversions) = 0
    ORDER BY cost DESC LIMIT 30
  `).all()

  const products = db.prepare('SELECT * FROM products WHERE status = ? ORDER BY margin_label DESC', ).all('approved')

  const ga4Pages = db.prepare(`
    SELECT page_path, country, AVG(bounce_rate) as bounce_rate, AVG(avg_session_duration) as duration, SUM(sessions) as sessions
    FROM ga4_pages WHERE date >= date('now', '-7 days')
    GROUP BY page_path, country ORDER BY sessions DESC LIMIT 30
  `).all()

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all()

  // Previous suggestions with results (feedback loop)
  const previousResults = db.prepare(`
    SELECT type, title, status, result_roas_before, result_roas_after
    FROM ai_suggestions WHERE applied_at IS NOT NULL AND applied_at >= date('now', '-30 days')
    ORDER BY applied_at DESC LIMIT 20
  `).all()

  const systemPrompt = `Je bent een expert Google Ads optimizer voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires actief in 6 landen (NL, DE, FR, ES, IT, internationaal).

${shopProfiles.map((p: any) => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Jouw taak
Analyseer de Google Ads data en geef concrete, actionable suggesties om de ROAS te maximaliseren. Let op:
- Marge-labels van producten (high margin producten verdienen meer budget)
- Cross-market kansen (wat werkt in land X kan ook werken in land Y)
- Zoekwoord-verspilling (kosten zonder conversies)
- Landingspagina-kwaliteit (hoge bounce rate = probleem)
- Trends (dalende ROAS = actie nodig)

## Eerdere suggesties en resultaten (feedback loop)
${previousResults.length > 0 ? JSON.stringify(previousResults, null, 2) : 'Nog geen eerdere suggesties toegepast.'}

Antwoord ALLEEN met een JSON object in dit formaat:
{
  "findings": ["bevinding 1", "bevinding 2", ...],
  "suggestions": [
    {
      "type": "budget_change|bid_adjustment|keyword_negative|ad_text_change|new_campaign|pause_campaign|keyword_add|schedule_change",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg waarom en verwacht effect",
      "details": { /* type-specifieke details, bijv. campaign_id, new_budget, keywords, etc. */ }
    }
  ]
}`

  const userMessage = `## Campagnes (laatste 7 dagen)
${JSON.stringify(campaigns, null, 2)}

## Dagelijkse trends (14 dagen)
${JSON.stringify(dailyTrends, null, 2)}

## Top zoekwoorden (7 dagen)
${JSON.stringify(topKeywords, null, 2)}

## Verspillende zoektermen (kosten zonder conversie)
${JSON.stringify(wastedTerms, null, 2)}

## Producten (Merchant Center)
${JSON.stringify(products.slice(0, 30), null, 2)}

## Landingspagina stats (GA4, 7 dagen)
${JSON.stringify(ga4Pages, null, 2)}

Analyseer deze data en geef je suggesties als JSON.`

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { text: string }).text.trim()

  // Parse response
  let parsed: { findings: string[]; suggestions: Array<{ type: string; priority: string; title: string; description: string; details: Record<string, unknown> }> }
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 500) })
    throw new Error('AI response kon niet geparsed worden')
  }

  // Store analysis
  const analysis = db.prepare(`
    INSERT INTO ai_analyses (model, input_tokens, output_tokens, findings, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(model, response.usage.input_tokens, response.usage.output_tokens, JSON.stringify(parsed.findings))

  const analysisId = Number(analysis.lastInsertRowid)

  // Store suggestions
  const stmtSuggestion = db.prepare(`
    INSERT INTO ai_suggestions (analysis_id, type, priority, title, description, details, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `)
  for (const s of parsed.suggestions) {
    stmtSuggestion.run(analysisId, s.type, s.priority, s.title, s.description, JSON.stringify(s.details))
  }

  // Log token usage
  db.prepare('INSERT INTO token_usage (analysis_id, call_type, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
    .run(analysisId, 'analysis', response.usage.input_tokens, response.usage.output_tokens)

  log('info', 'ai', `Analyse voltooid: ${parsed.suggestions.length} suggesties`, {
    analysisId, findings: parsed.findings.length, suggestions: parsed.suggestions.length,
    tokens: response.usage
  })

  return analysisId
}
```

- [ ] **Step 2: Create analyze API route**

POST `/api/ai/analyze`: triggers `runAnalysis()`, returns analysis ID + suggestion count.

- [ ] **Step 3: Create suggestions API route**

GET `/api/ai/suggestions`: list suggestions with filters (status, priority, type). PATCH: update suggestion status (applied/dismissed).

- [ ] **Step 4: Verify build + commit**

```bash
npm run build
git add -A && git commit -m "AI analysis engine: Claude analyzes local data, generates structured suggestions"
git push
```

---

## Task 11: Action Engine

**Files:**
- Create: `lib/action-engine.ts`, `app/api/actions/apply/route.ts`, `app/api/actions/log/route.ts`

- [ ] **Step 1: Create lib/action-engine.ts**

Applies suggestions by translating them into Google Ads API calls:

```typescript
import { getDb } from './db'
import { getSetting } from './settings'
import { log } from './logger'

export async function applySuggestion(suggestionId: number, appliedBy: 'manual' | 'semi_auto' | 'full_auto' = 'manual'): Promise<void> {
  const db = getDb()
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId) as any
  if (!suggestion) throw new Error('Suggestie niet gevonden')
  if (suggestion.status === 'applied') throw new Error('Al toegepast')

  const details = JSON.parse(suggestion.details)

  // Safety checks
  const maxBudgetChange = parseFloat(getSetting('safety_max_budget_change_day') || '50')
  const maxPercentChange = parseFloat(getSetting('safety_max_percent_change') || '25')

  let oldValue: string | null = null
  let newValue: string | null = null
  let googleResponse: unknown = null

  const { getGoogleAdsClient } = await import('./google-ads')

  switch (suggestion.type) {
    case 'budget_change': {
      // Validate against safety limits
      const budgetDiff = Math.abs((details.new_budget || 0) - (details.old_budget || 0))
      if (budgetDiff > maxBudgetChange) throw new Error(`Budget wijziging €${budgetDiff} overschrijdt limiet €${maxBudgetChange}`)

      oldValue = `€${details.old_budget}`
      newValue = `€${details.new_budget}`
      // Apply via Google Ads API
      googleResponse = await applyBudgetChange(details)
      break
    }
    case 'bid_adjustment': {
      const pctChange = Math.abs(details.percent_change || 0)
      if (pctChange > maxPercentChange) throw new Error(`Wijziging ${pctChange}% overschrijdt limiet ${maxPercentChange}%`)

      oldValue = `${details.old_bid}`
      newValue = `${details.new_bid}`
      googleResponse = await applyBidAdjustment(details)
      break
    }
    case 'keyword_negative': {
      newValue = details.keyword
      googleResponse = await addNegativeKeyword(details)
      break
    }
    case 'pause_campaign': {
      oldValue = 'ENABLED'
      newValue = 'PAUSED'
      googleResponse = await pauseCampaign(details)
      break
    }
    // ... other types: ad_text_change, new_campaign, keyword_add, schedule_change
  }

  // Record in action log
  db.prepare(`
    INSERT INTO action_log (suggestion_id, action_type, description, old_value, new_value, applied_by, google_response)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(suggestionId, suggestion.type, suggestion.title, oldValue, newValue, appliedBy, JSON.stringify(googleResponse))

  // Mark suggestion as applied
  db.prepare('UPDATE ai_suggestions SET status = ?, applied_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('applied', suggestionId)

  // Record ROAS before (for feedback loop)
  if (details.campaign_id) {
    const currentRoas = db.prepare(`
      SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
      FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-7 days')
    `).get(details.campaign_id) as { roas: number } | undefined
    if (currentRoas) {
      db.prepare('UPDATE ai_suggestions SET result_roas_before = ? WHERE id = ?').run(currentRoas.roas, suggestionId)
    }
  }

  log('info', 'google-ads', `Suggestie ${suggestionId} toegepast: ${suggestion.title}`, { type: suggestion.type, appliedBy })
}
```

Implementation of individual action functions (`applyBudgetChange`, `applyBidAdjustment`, `addNegativeKeyword`, `pauseCampaign`, etc.) uses `google-ads-api` mutate operations. Each wraps the API call in try/catch and returns the Google response.

- [ ] **Step 2: Create apply API route**

POST `/api/actions/apply`: accepts `{ suggestion_id }`, calls `applySuggestion()`.

- [ ] **Step 3: Create action log API route**

GET `/api/actions/log`: returns action_log entries with joined suggestion data. Supports pagination.

- [ ] **Step 4: Add auto-apply logic to scheduler**

In `lib/scheduler.ts`, after analysis completes: if autonomy level is `semi_auto` or `full_auto`, automatically apply eligible suggestions. Semi-auto: only budget_change, bid_adjustment, keyword_negative. Full-auto: all types.

- [ ] **Step 5: Verify build + commit**

```bash
npm run build
git add -A && git commit -m "Action engine: apply suggestions via Google Ads API with safety limits"
git push
```

---

## Task 12: AI Insights + Action Log Pages

**Files:**
- Create: `app/insights/page.tsx`, `app/actions/page.tsx`, `components/SuggestionCard.tsx`

- [ ] **Step 1: Create SuggestionCard.tsx**

Full suggestion card: priority badge (HOGE IMPACT/MEDIUM/LAAG in green/blue/gray), title, description, details preview (type-specific: budget change shows old→new, keyword_negative shows the keyword, etc.), "Pas toe" button (accent blue) + "Negeer" button (ghost). Applied suggestions show green "Toegepast" badge + date + ROAS before/after if available.

- [ ] **Step 2: Create AI Insights page**

Header with "Analyseer nu" button + last analysis timestamp. Filter bar: priority, type, status. List of SuggestionCards. Group by analysis date. Empty state: "Nog geen analyses. Start een analyse of configureer automatische analyses in Instellingen."

- [ ] **Step 3: Create Action Log page**

Chronological list. Each entry: timestamp, action type badge, description, old→new values, applied_by badge (handmatig/semi-auto/auto in different colors). Expandable to show full Google API response and AI reasoning.

- [ ] **Step 4: Verify build + commit**

```bash
npm run build
git add -A && git commit -m "AI Insights page with suggestion cards, Action Log page"
git push
```

---

## Task 13: Docker + CI/CD + Deployment

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `.github/workflows/docker.yml`, `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

Copy from stock dashboard — multi-stage build, node:22-alpine, standalone output, better-sqlite3 compilation, non-root user. Change app name references.

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  ads-optimizer:
    image: ghcr.io/rvdbot/ads:latest
    ports:
      - "3030:3000"
    volumes:
      - ./data:/app/data
    environment:
      - DATABASE_PATH=/app/data/ads-optimizer.db
      - NODE_ENV=production
    restart: unless-stopped
```

- [ ] **Step 3: Create entrypoint.sh**

Copy from stock dashboard. Ensures data directory exists with correct permissions.

- [ ] **Step 4: Create GitHub Actions workflow**

Copy from stock or cs-assistant repo — builds Docker image on push to main, pushes to ghcr.io/rvdbot/ads:latest.

- [ ] **Step 5: Create .dockerignore**

```
node_modules
.next
data
.git
.env*
```

- [ ] **Step 6: Verify Docker build locally**

```bash
docker build -t ads-optimizer .
```

- [ ] **Step 7: Commit + push**

```bash
git add -A && git commit -m "Docker, CI/CD, deployment config"
git push
```

---

## Task 14: ROAS Feedback Loop

**Files:**
- Modify: `lib/scheduler.ts`

- [ ] **Step 1: Add feedback measurement job**

After each sync, check for suggestions applied 7+ days ago that don't have `result_roas_after` yet. Calculate current ROAS for the affected campaign and update the suggestion. This data feeds back into the next AI analysis.

```typescript
export async function measureSuggestionResults(): Promise<void> {
  const db = getDb()
  const pending = db.prepare(`
    SELECT s.id, s.details, s.applied_at, s.result_roas_before
    FROM ai_suggestions s
    WHERE s.status = 'applied' AND s.result_roas_after IS NULL
      AND s.applied_at <= date('now', '-7 days')
  `).all() as Array<{ id: number; details: string; applied_at: string; result_roas_before: number }>

  for (const s of pending) {
    const details = JSON.parse(s.details)
    if (!details.campaign_id) continue

    const roas = db.prepare(`
      SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
      FROM daily_metrics WHERE campaign_id = ? AND date >= date(?, '+7 days')
    `).get(details.campaign_id, s.applied_at.split('T')[0]) as { roas: number } | undefined

    if (roas) {
      db.prepare('UPDATE ai_suggestions SET result_roas_after = ? WHERE id = ?').run(roas.roas, s.id)
      log('info', 'ai', `ROAS feedback: suggestie ${s.id} — voor: ${s.result_roas_before?.toFixed(1)}, na: ${roas.roas.toFixed(1)}`)
    }
  }
}
```

- [ ] **Step 2: Wire into scheduler**

Call `measureSuggestionResults()` after each sync completes.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ROAS feedback loop: measure suggestion impact after 7 days"
git push
```

---

## Execution Order Summary

| Task | Beschrijving | Afhankelijk van |
|------|-------------|-----------------|
| 1 | Project scaffolding | — |
| 2 | Database + auth + middleware | 1 |
| 3 | Settings UI + API | 2 |
| 4 | Navigation + dashboard layout | 2 |
| 5 | Google Ads API sync | 2 |
| 6 | Merchant Center + GA4 sync | 2 |
| 7 | Dashboard data API + charts | 4, 5 |
| 8 | Campaigns + Products + Keywords pages | 5, 6 |
| 9 | Shop Profile (website crawler) | 2 |
| 10 | AI Analysis Engine | 5, 6, 9 |
| 11 | Action Engine | 10 |
| 12 | AI Insights + Action Log pages | 10, 11 |
| 13 | Docker + CI/CD | 1 |
| 14 | ROAS Feedback Loop | 11 |

Tasks 3-4, 5-6, and 9 can run in parallel. Tasks 13 can run at any time after task 1.
