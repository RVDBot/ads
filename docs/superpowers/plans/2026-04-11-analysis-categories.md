# Analysis Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single AI analysis into three independent categories (Optimization, Growth, Branding) with separate tabs on the insights page, per-category triggers, and dedicated prompts.

**Architecture:** Add `category` column to `ai_analyses` and `ai_suggestions` tables. Refactor `lib/ai-analyzer.ts` into three analysis functions with shared helpers. Update insights page with tabs. Update API endpoints with category filter.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4, better-sqlite3, Anthropic SDK

---

### Task 1: Database migration — add category columns

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add category column to ai_analyses table**

In `lib/db.ts`, find the `CREATE TABLE IF NOT EXISTS ai_analyses` block and add a category column. Also add migration logic after the CREATE TABLE statements to add the column to existing databases.

Find this in `lib/db.ts` (around line 188):
```sql
CREATE TABLE IF NOT EXISTS ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  findings TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
);
```

Replace with:
```sql
CREATE TABLE IF NOT EXISTS ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  findings TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  category TEXT NOT NULL DEFAULT 'optimization'
);
```

- [ ] **Step 2: Add category column to ai_suggestions table**

Find the `CREATE TABLE IF NOT EXISTS ai_suggestions` block (around line 198):
```sql
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
```

Replace with:
```sql
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
  category TEXT NOT NULL DEFAULT 'optimization',
  FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id) ON DELETE CASCADE
);
```

- [ ] **Step 3: Add ALTER TABLE migrations for existing databases**

Find the migration section in `lib/db.ts` (search for `ALTER TABLE` or `try.*alter`). Add these migrations alongside the existing ones:

```typescript
// Add category columns (may already exist)
try { db.exec('ALTER TABLE ai_analyses ADD COLUMN category TEXT NOT NULL DEFAULT \'optimization\'') } catch {}
try { db.exec('ALTER TABLE ai_suggestions ADD COLUMN category TEXT NOT NULL DEFAULT \'optimization\'') } catch {}
```

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts
git commit -m "Add category column to ai_analyses and ai_suggestions tables"
```

---

### Task 2: Refactor ai-analyzer.ts — shared helpers and optimization analysis

**Files:**
- Modify: `lib/ai-analyzer.ts`

- [ ] **Step 1: Extract shared helpers**

At the top of `lib/ai-analyzer.ts` (after imports), add shared types and helper functions that all three analysis functions will use:

```typescript
type AnalysisCategory = 'optimization' | 'growth' | 'branding'

interface ParsedAnalysis {
  findings: string[]
  suggestions: Array<{
    type: string
    priority: string
    title: string
    description: string
    details: Record<string, unknown>
  }>
}

function createClient() {
  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) throw new Error('Anthropic API key niet geconfigureerd')
  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  return { client: new Anthropic({ apiKey }), model }
}

function parseAIResponse(raw: string): ParsedAnalysis {
  try {
    return JSON.parse(raw)
  } catch {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      return JSON.parse(cleaned)
    } catch {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1))
        } catch {
          log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
          throw new Error('AI response kon niet geparsed worden')
        }
      }
      log('error', 'ai', 'AI response parsing mislukt', { raw: raw.slice(0, 1000) })
      throw new Error('AI response kon niet geparsed worden')
    }
  }
}

function saveAnalysisResults(
  db: ReturnType<typeof getDb>,
  category: AnalysisCategory,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
  parsed: ParsedAnalysis,
): number {
  // Remove old pending suggestions for this category only
  db.prepare("DELETE FROM ai_suggestions WHERE status = 'pending' AND category = ?").run(category)

  const analysis = db.prepare(`
    INSERT INTO ai_analyses (model, input_tokens, output_tokens, findings, status, category)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(model, usage.input_tokens, usage.output_tokens, JSON.stringify(parsed.findings), category)

  const analysisId = Number(analysis.lastInsertRowid)

  const stmt = db.prepare(`
    INSERT INTO ai_suggestions (analysis_id, type, priority, title, description, details, status, category)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `)
  for (const s of parsed.suggestions) {
    stmt.run(analysisId, s.type, s.priority, s.title, s.description, JSON.stringify(s.details), category)
  }

  db.prepare('INSERT INTO token_usage (analysis_id, call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)')
    .run(analysisId, 'analysis', model, usage.input_tokens, usage.output_tokens)

  log('info', 'ai', `${category} analyse voltooid: ${parsed.suggestions.length} suggesties`, {
    analysisId, category, findings: parsed.findings.length, suggestions: parsed.suggestions.length, tokens: usage,
  })

  return analysisId
}

function getRecentActions(db: ReturnType<typeof getDb>) {
  const previousResults = db.prepare(`
    SELECT type, title, status, details, applied_at, result_roas_before, result_roas_after
    FROM ai_suggestions WHERE applied_at IS NOT NULL AND applied_at >= date('now', '-30 days')
    ORDER BY applied_at DESC LIMIT 20
  `).all() as Array<{ type: string; title: string; status: string; details: string; applied_at: string; result_roas_before: number | null; result_roas_after: number | null }>

  const recentActions = db.prepare(`
    SELECT action_type, description, old_value, new_value, created_at
    FROM action_log WHERE created_at >= date('now', '-14 days')
    ORDER BY created_at DESC LIMIT 30
  `).all()

  const previousForAI = previousResults.map(r => {
    let details: Record<string, unknown> = {}
    try { details = JSON.parse(r.details) } catch {}
    return {
      type: r.type, title: r.title, applied_at: r.applied_at,
      days_ago: Math.round((Date.now() - new Date(r.applied_at).getTime()) / 86400000),
      details, roas_before: r.result_roas_before, roas_after: r.result_roas_after,
    }
  })

  return { previousForAI, recentActions }
}

function recentActionsPrompt(previousForAI: unknown[], recentActions: unknown[]): string {
  return `## Recent toegepaste acties
BELANGRIJK: Onderstaande acties zijn recent uitgevoerd. Houd hier rekening mee:
- Acties van de afgelopen 1-3 dagen hebben nog GEEN effect gehad op de data. Stel NIET dezelfde actie opnieuw voor.
- Gebruik de "days_ago" waarde om in te schatten of een actie al effect kan hebben gehad (minimaal 3-7 dagen nodig).

### Via AI-suggesties toegepast:
${previousForAI.length > 0 ? JSON.stringify(previousForAI, null, 2) : 'Geen.'}

### Via chat/handmatig toegepast:
${recentActions.length > 0 ? JSON.stringify(recentActions, null, 2) : 'Geen.'}`
}
```

- [ ] **Step 2: Rename existing runAnalysis to runOptimizationAnalysis**

Rename the existing `runAnalysis` function to `runOptimizationAnalysis`. Keep all its current data gathering and prompt logic intact, but update it to use the shared helpers:

```typescript
export async function runOptimizationAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  // --- All existing data gathering code stays exactly the same ---
  // campaigns, dailyTrends, topKeywords, wastedTerms, products, currentAds,
  // adsForAI, productsByCampaign, adGroupPerformance, ga4Pages, shopProfiles
  // (copy lines 14-108 from existing runAnalysis)

  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een expert Google Ads optimizer voor SpeedRope Shop...`
  // Keep the ENTIRE existing system prompt and user message unchanged

  const response = await client.messages.create({
    model, max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)
  return saveAnalysisResults(db, 'optimization', model, response.usage, parsed)
}
```

- [ ] **Step 3: Create wrapper functions**

At the bottom of the file, add the wrapper and category dispatch:

```typescript
export async function runAnalysisByCategory(category: AnalysisCategory, period = 14): Promise<number> {
  switch (category) {
    case 'optimization': return runOptimizationAnalysis(period)
    case 'growth': return runGrowthAnalysis(period)
    case 'branding': return runBrandingAnalysis(period)
  }
}

export async function runAnalysis(period = 14): Promise<number[]> {
  const results: number[] = []
  for (const cat of ['optimization', 'growth', 'branding'] as AnalysisCategory[]) {
    try {
      results.push(await runAnalysisByCategory(cat, period))
    } catch (e) {
      log('error', 'ai', `${cat} analyse mislukt`, { error: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/ai-analyzer.ts
git commit -m "Refactor ai-analyzer: extract shared helpers, rename to runOptimizationAnalysis"
```

---

### Task 3: Add growth analysis function

**Files:**
- Modify: `lib/ai-analyzer.ts`

- [ ] **Step 1: Add runGrowthAnalysis function**

Add this function after `runOptimizationAnalysis` in `lib/ai-analyzer.ts`:

```typescript
export async function runGrowthAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  const campaigns = db.prepare(`
    SELECT c.name, c.country, c.type,
      SUM(dm.cost) as total_cost, SUM(dm.conversion_value) as total_value,
      SUM(dm.conversions) as total_conv, SUM(dm.clicks) as total_clicks,
      SUM(dm.impressions) as total_impressions,
      CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-' || ? || ' days')
    WHERE c.status = 'ENABLED'
    GROUP BY c.id
  `).all(period)

  // Keywords performing well — potential for expansion to other markets
  const topConvertingKeywords = db.prepare(`
    SELECT k.text, k.match_type, c.name as campaign, c.country,
      SUM(km.cost) as cost, SUM(km.clicks) as clicks,
      SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
      CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas
    FROM keywords k
    JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-' || ? || ' days')
    JOIN ad_groups ag ON ag.id = k.adgroup_id
    JOIN campaigns c ON c.id = ag.campaign_id
    WHERE km.conversions > 0
    GROUP BY k.text, c.country ORDER BY conversions DESC LIMIT 50
  `).all(period)

  // Search terms that convert — candidates for new keywords
  const convertingSearchTerms = db.prepare(`
    SELECT search_term, campaign_name, SUM(cost) as cost, SUM(clicks) as clicks,
      SUM(conversions) as conversions, SUM(conversion_value) as value
    FROM search_terms WHERE date >= date('now', '-' || ? || ' days') AND conversions > 0
    GROUP BY search_term ORDER BY conversions DESC LIMIT 30
  `).all(period)

  const products = db.prepare(`
    SELECT title, price, margin_label, country
    FROM products WHERE status = 'approved'
    ORDER BY margin_label DESC
  `).all()

  // GA4 analytics per country — organic traffic reveals untapped markets
  const ga4ByCountry = db.prepare(`
    SELECT country, SUM(sessions) as sessions, AVG(bounce_rate) as bounce_rate,
      AVG(avg_session_duration) as avg_duration
    FROM ga4_pages WHERE date >= date('now', '-' || ? || ' days') AND country IS NOT NULL
    GROUP BY country ORDER BY sessions DESC
  `).all(period)

  // GA4 top pages per country — which products attract organic interest
  const ga4TopPages = db.prepare(`
    SELECT page_path, country, SUM(sessions) as sessions, AVG(bounce_rate) as bounce_rate
    FROM ga4_pages WHERE date >= date('now', '-' || ? || ' days') AND country IS NOT NULL
    GROUP BY page_path, country ORDER BY sessions DESC LIMIT 50
  `).all(period)

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all() as Array<{ country: string; profile_content: string }>
  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een groei-strateeg voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires.

${shopProfiles.map(p => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Marktdekking
SpeedRopeShop is actief in deze markten:
- NL campagnes: bedienen Nederland + België (Nederlandstalig)
- FR campagnes: bedienen Frankrijk + België (Franstalig)
- DE campagnes: bedienen Duitsland + Oostenrijk + Denemarken (Duitstalig)
- ES campagnes: bedienen Spanje
- IT campagnes: bedienen Italië
- COM campagnes (Engels): bedienen NL, BE, LU, DE, AT, DK, FR, ES, IT, UK, NO, CH, SE, GR, FI

## Jouw taak
Analyseer de data en identificeer GROEI-kansen om meer verkeer en omzet te genereren. Focus op:
- Welke landen/markten worden nog niet bediend maar passen bij de marktstructuur?
- Welke goed presterende zoekwoorden/producten in land X bestaan nog niet in land Y?
- Welke product-categorieën hebben nog geen campagne?
- Waar komt al organisch verkeer vandaan zonder ads? (= bewezen kans voor ads)
- Nieuwe zoekwoorden op basis van goed converterende search terms
- High-margin producten die meer exposure verdienen

${recentActionsPrompt(previousForAI, recentActions)}

Antwoord ALLEEN met een JSON object (GEEN markdown code fences). Max 10 findings, max 10 suggesties. Formaat:
{
  "findings": ["bevinding 1", ...],
  "suggestions": [
    {
      "type": "new_campaign|keyword_add|market_expansion",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg waarom en verwacht effect",
      "details": { ... }
    }
  ]
}

## Details-velden per type
- **new_campaign**: { "campaign_name": "naam", "country": "nl", "type": "SEARCH|SHOPPING", "daily_budget": 10.0, "keywords": ["kw1"] }
- **keyword_add**: { "campaign_name": "exacte naam", "adgroup_name": "exacte naam", "keywords": ["kw1", "kw2"], "match_type": "PHRASE|EXACT|BROAD" }
- **market_expansion**: { "target_country": "at", "source_country": "de", "rationale": "uitleg", "recommended_budget": 10.0, "recommended_campaign_type": "SEARCH|SHOPPING" }`

  const userMessage = `## Huidige campagnes (laatste ${period} dagen)
${JSON.stringify(campaigns, null, 2)}

## Top converterende zoekwoorden per land (${period} dagen)
${JSON.stringify(topConvertingKeywords, null, 2)}

## Converterende zoektermen (${period} dagen)
${JSON.stringify(convertingSearchTerms, null, 2)}

## Producten (Merchant Center)
${JSON.stringify((products as any[]).slice(0, 40).map(p => ({ title: p.title, price: p.price, margin_label: p.margin_label, country: p.country })), null, 2)}

## Organisch verkeer per land (GA4, ${period} dagen)
${JSON.stringify(ga4ByCountry, null, 2)}

## Top landingspagina's per land (GA4, ${period} dagen)
${JSON.stringify(ga4TopPages, null, 2)}

Identificeer groei-kansen als JSON.`

  const response = await client.messages.create({
    model, max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)
  return saveAnalysisResults(db, 'growth', model, response.usage, parsed)
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai-analyzer.ts
git commit -m "Add growth analysis function with market coverage and GA4 data"
```

---

### Task 4: Add branding analysis function

**Files:**
- Modify: `lib/ai-analyzer.ts`

- [ ] **Step 1: Add runBrandingAnalysis function**

Add this function after `runGrowthAnalysis`:

```typescript
export async function runBrandingAnalysis(period = 14): Promise<number> {
  const { client, model } = createClient()
  const db = getDb()

  // Branded search terms — how is the brand performing?
  const brandedTerms = db.prepare(`
    SELECT search_term, campaign_name, SUM(cost) as cost, SUM(clicks) as clicks,
      SUM(impressions) as impressions, SUM(conversions) as conversions, SUM(conversion_value) as value
    FROM search_terms WHERE date >= date('now', '-' || ? || ' days')
      AND (LOWER(search_term) LIKE '%speedrope%' OR LOWER(search_term) LIKE '%speed rope%'
           OR LOWER(search_term) LIKE '%speedropeshop%')
    GROUP BY search_term ORDER BY impressions DESC LIMIT 30
  `).all(period)

  // All campaign types — what channels are already used?
  const campaignTypes = db.prepare(`
    SELECT name, country, type, status,
      SUM(dm.impressions) as impressions, SUM(dm.clicks) as clicks, SUM(dm.cost) as cost
    FROM campaigns c
    LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-' || ? || ' days')
    GROUP BY c.id
  `).all(period)

  const products = db.prepare(`
    SELECT title, price, margin_label, country
    FROM products WHERE status = 'approved'
    ORDER BY margin_label DESC LIMIT 30
  `).all()

  const shopProfiles = db.prepare('SELECT country, profile_content FROM shop_profile').all() as Array<{ country: string; profile_content: string }>
  const { previousForAI, recentActions } = getRecentActions(db)

  const systemPrompt = `Je bent een branding-strateeg voor SpeedRope Shop, een e-commerce shop voor speedropes en fitness accessoires.

${shopProfiles.map(p => `## Shop Profiel ${p.country.toUpperCase()}\n${p.profile_content}`).join('\n\n')}

## Marktdekking
- NL: Nederland + België (NL) | FR: Frankrijk + België (FR) | DE: Duitsland + Oostenrijk + Denemarken
- ES: Spanje | IT: Italië | COM (Engels): NL, BE, LU, DE, AT, DK, FR, ES, IT, UK, NO, CH, SE, GR, FI

## Jouw taak
SpeedRopeShop heeft momenteel GEEN branding-campagnes (Display, YouTube, branded search). Analyseer de data en stel voor hoe merkbekendheid vergroot kan worden. Focus op:
- Display-campagnes: welke markten, welk budget, welke doelgroep
- YouTube/Video-campagnes: welke markten, type content (product demos, reviews)
- Branded search: campagnes om de merknaam te beschermen in zoekresultaten
- Retargeting: bezoekers opnieuw bereiken via Display/YouTube
- Per voorstel: aanbevolen budget, doelland, verwacht bereik

${recentActionsPrompt(previousForAI, recentActions)}

Antwoord ALLEEN met een JSON object (GEEN markdown code fences). Max 8 findings, max 8 suggesties. Formaat:
{
  "findings": ["bevinding 1", ...],
  "suggestions": [
    {
      "type": "brand_campaign|display_campaign|youtube_campaign",
      "priority": "high|medium|low",
      "title": "Korte titel",
      "description": "Uitleg met verwacht bereik en aanbevolen budget",
      "details": { ... }
    }
  ]
}

## Details-velden per type
- **brand_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 5.0, "keywords": ["speedrope shop", "speedropeshop"], "rationale": "uitleg" }
- **display_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 10.0, "target_audience": "beschrijving doelgroep", "rationale": "uitleg" }
- **youtube_campaign**: { "campaign_name": "voorgestelde naam", "country": "nl", "daily_budget": 15.0, "video_concept": "beschrijving video type", "rationale": "uitleg" }`

  const userMessage = `## Branded zoektermen (laatste ${period} dagen)
${JSON.stringify(brandedTerms, null, 2)}

## Alle campagnes en kanalen
${JSON.stringify(campaignTypes, null, 2)}

## Producten (top 30)
${JSON.stringify(products, null, 2)}

Stel branding-strategieën voor als JSON.`

  const response = await client.messages.create({
    model, max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = (response.content[0] as { type: string; text: string }).text.trim()
  const parsed = parseAIResponse(raw)
  return saveAnalysisResults(db, 'branding', model, response.usage, parsed)
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai-analyzer.ts
git commit -m "Add branding analysis function"
```

---

### Task 5: Update API endpoints with category support

**Files:**
- Modify: `app/api/ai/analyze/route.ts`
- Modify: `app/api/ai/suggestions/route.ts`

- [ ] **Step 1: Update analyze endpoint**

Replace the contents of `app/api/ai/analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  try {
    let period = 14
    let category: string | undefined
    try {
      const body = await req.json()
      if (body.period && [7, 14, 30, 90].includes(body.period)) period = body.period
      if (body.category && ['optimization', 'growth', 'branding'].includes(body.category)) {
        category = body.category
      }
    } catch { /* no body is fine, use default */ }

    const { runAnalysis, runAnalysisByCategory } = await import('@/lib/ai-analyzer')
    const { getDb } = await import('@/lib/db')
    const db = getDb()

    if (category) {
      const analysisId = await runAnalysisByCategory(category as any, period)
      const count = (db.prepare('SELECT COUNT(*) as count FROM ai_suggestions WHERE analysis_id = ?').get(analysisId) as { count: number }).count
      return NextResponse.json({ analysisId, category, suggestions: count })
    } else {
      const ids = await runAnalysis(period)
      const total = ids.reduce((sum, id) => {
        const row = db.prepare('SELECT COUNT(*) as count FROM ai_suggestions WHERE analysis_id = ?').get(id) as { count: number }
        return sum + row.count
      }, 0)
      return NextResponse.json({ analysisIds: ids, suggestions: total })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Analyse mislukt' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Update suggestions endpoint with category filter**

In `app/api/ai/suggestions/route.ts`, add category filter support. Find the line:

```typescript
  const type = req.nextUrl.searchParams.get('type')
```

Add after it:

```typescript
  const category = req.nextUrl.searchParams.get('category')
```

Find the line:

```typescript
  if (type) { where += ' AND s.type = ?'; params.push(type) }
```

Add after it:

```typescript
  if (category) { where += ' AND s.category = ?'; params.push(category) }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/ai/analyze/route.ts app/api/ai/suggestions/route.ts
git commit -m "Add category parameter to analyze and suggestions API endpoints"
```

---

### Task 6: Update scheduler to call all three analyses

**Files:**
- Modify: `lib/scheduler.ts`

- [ ] **Step 1: Update the import in runScheduledSync**

In `lib/scheduler.ts`, find this block inside `runScheduledSync`:

```typescript
        try {
          const { runAnalysis } = await import('./ai-analyzer')
          await runAnalysis()
        } catch (e) {
```

The import already matches because `runAnalysis` now calls all three. No change needed here — `runAnalysis()` already calls all three categories as implemented in Task 2. Verify and move on.

- [ ] **Step 2: Commit (if any changes)**

No changes needed — `runAnalysis()` wrapper handles this. Skip this commit if no changes.

---

### Task 7: Update SuggestionCard for non-actionable types

**Files:**
- Modify: `components/SuggestionCard.tsx`

- [ ] **Step 1: Add new type badges and hide apply button for advisory types**

In `components/SuggestionCard.tsx`, find the `typeBadges` constant (around line 28) and add the new types:

```typescript
const typeBadges: Record<string, string> = {
  budget_change: 'Budget',
  bid_adjustment: 'Bieding',
  keyword_negative: 'Negatief KW',
  ad_text_change: 'Advertentie',
  new_campaign: 'Nieuwe Campagne',
  pause_campaign: 'Pauzeer',
  keyword_add: 'Zoekwoord',
  schedule_change: 'Schema',
  market_expansion: 'Marktuitbreiding',
  brand_campaign: 'Brand Campagne',
  display_campaign: 'Display Campagne',
  youtube_campaign: 'YouTube Campagne',
}

const ADVISORY_TYPES = new Set(['market_expansion', 'brand_campaign', 'display_campaign', 'youtube_campaign'])
```

Then find the block that renders the Apply/Dismiss buttons (around line 126):

```typescript
        {status === 'pending' && (
```

Replace with:

```typescript
        {status === 'pending' && !ADVISORY_TYPES.has(type) && (
```

- [ ] **Step 2: Commit**

```bash
git add components/SuggestionCard.tsx
git commit -m "Add advisory type badges and hide apply button for non-actionable suggestions"
```

---

### Task 8: Update insights page with category tabs

**Files:**
- Modify: `app/insights/page.tsx`

- [ ] **Step 1: Replace insights page with tabbed version**

Replace the entire contents of `app/insights/page.tsx` with:

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import Nav from '@/components/Nav'
import SuggestionCard from '@/components/SuggestionCard'
import { apiFetch, useSyncRefresh } from '@/lib/api'

interface Suggestion {
  id: number
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  type: string
  status: string
  details: string
  campaign_name?: string | null
  applied_at?: string
  result_roas_before?: number
  result_roas_after?: number
  analysis_date?: string
  model?: string
}

const CATEGORIES = [
  { value: 'optimization', label: 'Optimalisatie' },
  { value: 'growth', label: 'Groei' },
  { value: 'branding', label: 'Branding' },
] as const

type Category = typeof CATEGORIES[number]['value']

const TYPE_OPTIONS: Record<Category, Array<{ value: string; label: string }>> = {
  optimization: [
    { value: '', label: 'Alle types' },
    { value: 'budget_change', label: 'Budget' },
    { value: 'bid_adjustment', label: 'Bieding' },
    { value: 'keyword_negative', label: 'Negatief KW' },
    { value: 'ad_text_change', label: 'Advertentie' },
    { value: 'new_campaign', label: 'Nieuwe Campagne' },
    { value: 'pause_campaign', label: 'Pauzeer' },
    { value: 'keyword_add', label: 'Zoekwoord' },
    { value: 'schedule_change', label: 'Schema' },
  ],
  growth: [
    { value: '', label: 'Alle types' },
    { value: 'new_campaign', label: 'Nieuwe Campagne' },
    { value: 'keyword_add', label: 'Zoekwoord' },
    { value: 'market_expansion', label: 'Marktuitbreiding' },
  ],
  branding: [
    { value: '', label: 'Alle types' },
    { value: 'brand_campaign', label: 'Brand Campagne' },
    { value: 'display_campaign', label: 'Display Campagne' },
    { value: 'youtube_campaign', label: 'YouTube Campagne' },
  ],
}

export default function InsightsPage() {
  const [category, setCategory] = useState<Category>('optimization')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null)
  const [showPeriodMenu, setShowPeriodMenu] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const syncRev = useSyncRefresh()

  const fetchSuggestions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('category', category)
      if (priorityFilter) params.set('priority', priorityFilter)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      const res = await apiFetch(`/api/ai/suggestions?${params}`)
      const data = await res.json()
      const items: Suggestion[] = data.suggestions || []
      setSuggestions(items)
      if (items.length > 0 && items[0].analysis_date) {
        setLastAnalysis(items[0].analysis_date)
      } else {
        setLastAnalysis(null)
      }
    } catch {
      /* empty */
    } finally {
      setLoading(false)
    }
  }, [category, priorityFilter, typeFilter, statusFilter, syncRev])

  useEffect(() => { fetchSuggestions() }, [fetchSuggestions])

  // Reset type filter when changing category
  useEffect(() => { setTypeFilter('') }, [category])

  async function handleAnalyze(period = 14) {
    setShowPeriodMenu(false)
    setAnalyzing(true)
    try {
      await apiFetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, category }),
      })
      await fetchSuggestions()
    } finally {
      setAnalyzing(false)
    }
  }

  const counts = {
    total: suggestions.length,
    pending: suggestions.filter(s => s.status === 'pending').length,
    applied: suggestions.filter(s => s.status === 'applied').length,
    dismissed: suggestions.filter(s => s.status === 'dismissed').length,
  }

  const categoryLabel = CATEGORIES.find(c => c.value === category)?.label || category

  return (
    <>
      <Nav />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <div>
            <h1 className="text-[16px] font-semibold text-text-primary">AI Inzichten</h1>
            {lastAnalysis && (
              <p className="text-[11px] text-text-tertiary mt-0.5">
                Laatste {categoryLabel.toLowerCase()} analyse: {new Date(lastAnalysis).toLocaleString('nl-NL')}
              </p>
            )}
          </div>
          <div className="relative">
            <div className="flex">
              <button onClick={() => handleAnalyze(14)} disabled={analyzing}
                className="px-4 py-2 bg-accent text-white text-[12px] font-semibold rounded-l-lg hover:bg-accent-hover disabled:opacity-50 transition-colors">
                {analyzing ? 'Analyseren...' : `${categoryLabel} analyseren`}
              </button>
              <button onClick={() => setShowPeriodMenu(!showPeriodMenu)} disabled={analyzing}
                className="px-2 py-2 bg-accent text-white rounded-r-lg hover:bg-accent-hover disabled:opacity-50 transition-colors border-l border-white/20">
                <svg className={`w-3 h-3 transition-transform ${showPeriodMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {showPeriodMenu && (
              <div className="absolute right-0 mt-1 bg-surface-1 border border-border-subtle rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                {[
                  { days: 7, label: '7 dagen' },
                  { days: 14, label: '14 dagen' },
                  { days: 30, label: '30 dagen' },
                  { days: 90, label: '90 dagen' },
                ].map(opt => (
                  <button key={opt.days} onClick={() => handleAnalyze(opt.days)}
                    className="w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-2 transition-colors">
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5 mb-5 w-fit">
          {CATEGORIES.map(cat => (
            <button key={cat.value} onClick={() => setCategory(cat.value)}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                category === cat.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Totaal', value: counts.total, color: 'text-text-primary' },
            { label: 'In afwachting', value: counts.pending, color: 'text-accent' },
            { label: 'Toegepast', value: counts.applied, color: 'text-success' },
            { label: 'Genegeerd', value: counts.dismissed, color: 'text-text-tertiary' },
          ].map(stat => (
            <div key={stat.label} className="bg-surface-1 border border-border-subtle rounded-xl px-4 py-3">
              <div className="text-[11px] text-text-tertiary font-medium">{stat.label}</div>
              <div className={`text-[20px] font-bold mt-0.5 ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle' },
              { value: 'high', label: 'Hoog' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Laag' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setPriorityFilter(opt.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  priorityFilter === opt.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="bg-surface-1 border border-border-subtle rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent">
            {TYPE_OPTIONS[category].map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="flex bg-surface-1 border border-border-subtle rounded-lg p-0.5 gap-0.5">
            {[
              { value: '', label: 'Alle' },
              { value: 'pending', label: 'In afwachting' },
              { value: 'applied', label: 'Toegepast' },
              { value: 'dismissed', label: 'Genegeerd' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  statusFilter === opt.value ? 'bg-accent text-white' : 'text-text-tertiary hover:text-text-secondary'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] text-text-tertiary ml-auto">
            {suggestions.length} suggestie{suggestions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Suggestions list */}
        <div className="bg-surface-1 border border-border-subtle rounded-2xl p-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : suggestions.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-[32px] mb-3 opacity-40">&#x1F50D;</div>
              <div className="text-[14px] font-medium text-text-secondary mb-1">Nog geen {categoryLabel.toLowerCase()} analyses</div>
              <div className="text-[12px] text-text-tertiary max-w-sm mx-auto">
                Start een {categoryLabel.toLowerCase()} analyse om suggesties te ontvangen.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  description={s.description}
                  priority={s.priority}
                  type={s.type}
                  status={s.status}
                  details={s.details || '{}'}
                  campaignName={s.campaign_name}
                  appliedAt={s.applied_at}
                  roasBefore={s.result_roas_before}
                  roasAfter={s.result_roas_after}
                  onUpdate={fetchSuggestions}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/insights/page.tsx
git commit -m "Add category tabs to insights page with per-category filters and triggers"
```

---

### Task 9: Final integration and push

**Files:** none new

- [ ] **Step 1: Verify the app builds**

```bash
npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Push all commits**

```bash
git push
```
