# AI Chat Assistent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a context-aware AI chat interface to the Ads Optimizer dashboard that lets users ask questions, discuss suggestions, and propose actions via streaming conversation with Claude.

**Architecture:** A ChatPanel component (slide-over desktop, floating bubble mobile) connects to a `/api/chat` streaming endpoint. The endpoint uses Claude with tool-use to fetch campaign data on-demand and propose actions inline. Chat history is persisted per context (campaign/suggestion/global) in SQLite.

**Tech Stack:** Next.js App Router, Anthropic SDK `@anthropic-ai/sdk` (streaming + tool use), SQLite via better-sqlite3, Server-Sent Events, Tailwind CSS v4

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/db.ts` | Add `chat_threads` and `chat_messages` tables |
| `lib/chat-tools.ts` | **NEW** — Define AI tools (get_campaign_metrics, get_keywords, etc.) and their execution logic |
| `lib/chat-context.ts` | **NEW** — Build system prompt and base context for each context_type |
| `app/api/chat/route.ts` | **NEW** — POST endpoint: streaming chat with Claude + tool use |
| `app/api/chat/threads/route.ts` | **NEW** — GET: list threads, filtered by context_type/context_id |
| `app/api/chat/threads/[id]/route.ts` | **NEW** — GET: messages for a thread |
| `app/api/chat/apply-action/route.ts` | **NEW** — POST: apply a proposed_action from a chat message |
| `components/ChatPanel.tsx` | **NEW** — Chat UI: slide-over (desktop) / floating bubble (mobile) |
| `components/ChatMessage.tsx` | **NEW** — Single message renderer (user/assistant/action cards) |
| `components/ChatProvider.tsx` | **NEW** — Context provider for global chat state (open/close, context) |
| `components/Nav.tsx` | Add AI chat button |
| `components/SuggestionCard.tsx` | Add "Bespreek" button |
| `app/campaigns/[id]/page.tsx` | Add "Vraag AI" button |
| `app/layout.tsx` | Wrap with ChatProvider |

---

### Task 1: Database Schema — chat_threads and chat_messages

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add chat tables to initSchema**

In `lib/db.ts`, add the following two CREATE TABLE statements inside the `initSchema` function, after the existing `logs` table creation (before the closing backtick of `db.exec`):

```sql
    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      context_type TEXT NOT NULL,
      context_id INTEGER,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      proposed_actions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );
```

- [ ] **Step 2: Verify the app starts**

Run: `cd "/Users/ruben/Library/CloudStorage/ProtonDrive-ruben.vandenbussche@proton.me-folder/_Personal/Claude code/ads-optimizer" && npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "feat(chat): add chat_threads and chat_messages tables"
```

---

### Task 2: Chat Tools — data fetching and action proposals

**Files:**
- Create: `lib/chat-tools.ts`

- [ ] **Step 1: Create lib/chat-tools.ts**

This file defines the Anthropic tool schemas and execution functions. Each tool queries the SQLite database using the same patterns as the existing API routes.

```typescript
import { getDb } from './db'

// Anthropic tool definitions for Claude tool-use
export const CHAT_TOOLS = [
  {
    name: 'get_campaign_metrics',
    description: 'Haal dagelijkse metrics op voor een campagne (kosten, ROAS, conversies, klikken). Gebruik dit om prestaties te analyseren.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
        period: { type: 'number', description: 'Aantal dagen terug (default 30)', default: 30 },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_keywords',
    description: 'Haal zoekwoorden op voor een campagne met prestatie-metrics (kosten, klikken, conversies, ROAS).',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_search_terms',
    description: 'Haal zoekopdrachten op voor een campagne met kosten en conversies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_ad_texts',
    description: 'Haal huidige advertentieteksten (headlines en descriptions) op voor een campagne.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_products',
    description: 'Haal producten op uit Merchant Center, optioneel gefilterd op land.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: 'Landcode (nl, de, fr, es, it, com). Leeg = alle landen.' },
      },
      required: [],
    },
  },
  {
    name: 'get_suggestions',
    description: 'Haal lopende AI suggesties op, optioneel gefilterd op campagne.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'Database ID van de campagne (optioneel)' },
      },
      required: [],
    },
  },
  {
    name: 'propose_action',
    description: 'Stel een concrete actie voor aan de gebruiker. De gebruiker kan deze goedkeuren of afwijzen. Gebruik dit ALLEEN na analyse van de data. Leg altijd uit waarom je deze actie voorstelt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['budget_change', 'bid_adjustment', 'keyword_negative', 'pause_campaign', 'keyword_add', 'ad_text_change', 'new_campaign', 'schedule_change'],
          description: 'Type actie',
        },
        title: { type: 'string', description: 'Korte beschrijving van de actie' },
        details: {
          type: 'object',
          description: 'Actie-specifieke details. budget_change: {campaign_name, old_budget, new_budget}. keyword_negative: {campaign_name, keyword, match_type}. bid_adjustment: {campaign_name, adgroup_name, old_bid, new_bid}. pause_campaign: {campaign_name}. keyword_add: {campaign_name, adgroup_name, keywords[], match_type}. ad_text_change: {campaign_name, adgroup_name, headlines[], descriptions[]}.',
        },
      },
      required: ['type', 'title', 'details'],
    },
  },
]

// Execute a tool call and return the result as a string
export function executeTool(name: string, input: Record<string, unknown>): { result: string; proposedAction?: { type: string; title: string; details: Record<string, unknown> } } {
  const db = getDb()

  switch (name) {
    case 'get_campaign_metrics': {
      const period = (input.period as number) || 30
      const metrics = db.prepare(`
        SELECT date, cost, clicks, impressions, conversions, conversion_value, roas, avg_cpc, ctr
        FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-' || ? || ' days')
        ORDER BY date DESC
      `).all(input.campaign_id, period)
      const totals = db.prepare(`
        SELECT SUM(cost) as cost, SUM(clicks) as clicks, SUM(conversions) as conversions,
          SUM(conversion_value) as value,
          CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END as roas
        FROM daily_metrics WHERE campaign_id = ? AND date >= date('now', '-' || ? || ' days')
      `).get(input.campaign_id, period)
      return { result: JSON.stringify({ totals, daily: metrics }) }
    }

    case 'get_keywords': {
      const keywords = db.prepare(`
        SELECT k.text, k.match_type, k.bid, k.status, ag.name as adgroup,
          SUM(km.cost) as cost, SUM(km.clicks) as clicks,
          SUM(km.conversions) as conversions, SUM(km.conversion_value) as value,
          CASE WHEN SUM(km.cost) > 0 THEN SUM(km.conversion_value) / SUM(km.cost) ELSE 0 END as roas
        FROM keywords k
        JOIN ad_groups ag ON ag.id = k.adgroup_id
        LEFT JOIN keyword_metrics km ON km.keyword_id = k.id AND km.date >= date('now', '-30 days')
        WHERE ag.campaign_id = ?
        GROUP BY k.id ORDER BY cost DESC
      `).all(input.campaign_id)
      return { result: JSON.stringify(keywords) }
    }

    case 'get_search_terms': {
      const terms = db.prepare(`
        SELECT search_term, SUM(cost) as cost, SUM(clicks) as clicks,
          SUM(conversions) as conversions, SUM(conversion_value) as value
        FROM search_terms WHERE campaign_id = ? AND date >= date('now', '-30 days')
        GROUP BY search_term ORDER BY cost DESC LIMIT 50
      `).all(input.campaign_id)
      return { result: JSON.stringify(terms) }
    }

    case 'get_ad_texts': {
      const ads = db.prepare(`
        SELECT ag.name as adgroup, a.headlines, a.descriptions, a.status
        FROM ads a
        JOIN ad_groups ag ON ag.id = a.adgroup_id
        WHERE ag.campaign_id = ? AND a.status = 'ENABLED'
        ORDER BY ag.name
      `).all(input.campaign_id)
      return { result: JSON.stringify(ads.map((a: any) => ({
        adgroup: a.adgroup,
        headlines: JSON.parse(a.headlines || '[]'),
        descriptions: JSON.parse(a.descriptions || '[]'),
      }))) }
    }

    case 'get_products': {
      const country = input.country as string | undefined
      let products
      if (country) {
        products = db.prepare('SELECT title, price, currency, availability, margin_label, country FROM products WHERE LOWER(country) = LOWER(?) AND status = ? LIMIT 50').all(country, 'approved')
      } else {
        products = db.prepare('SELECT title, price, currency, availability, margin_label, country FROM products WHERE status = ? LIMIT 50').all('approved')
      }
      return { result: JSON.stringify(products) }
    }

    case 'get_suggestions': {
      let suggestions
      if (input.campaign_id) {
        suggestions = db.prepare(`
          SELECT s.id, s.type, s.priority, s.title, s.description, s.details, s.status
          FROM ai_suggestions s
          JOIN ai_analyses a ON a.id = s.analysis_id
          WHERE s.details LIKE '%' || (SELECT name FROM campaigns WHERE id = ?) || '%'
          ORDER BY s.id DESC LIMIT 20
        `).all(input.campaign_id)
      } else {
        suggestions = db.prepare(`
          SELECT id, type, priority, title, description, details, status
          FROM ai_suggestions ORDER BY id DESC LIMIT 20
        `).all()
      }
      return { result: JSON.stringify(suggestions) }
    }

    case 'propose_action': {
      const action = {
        type: input.type as string,
        title: input.title as string,
        details: input.details as Record<string, unknown>,
      }
      return {
        result: `Actie voorgesteld aan gebruiker: ${action.title}`,
        proposedAction: action,
      }
    }

    default:
      return { result: `Onbekende tool: ${name}` }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add lib/chat-tools.ts
git commit -m "feat(chat): add AI tool definitions and execution logic"
```

---

### Task 3: Chat Context Builder — system prompts per context type

**Files:**
- Create: `lib/chat-context.ts`

- [ ] **Step 1: Create lib/chat-context.ts**

This file builds the system prompt with base context depending on context_type.

```typescript
import { getDb } from './db'

interface ChatContext {
  systemPrompt: string
  threadTitle: string
}

export function buildChatContext(contextType: string, contextId: number | null): ChatContext {
  const db = getDb()

  const baseRole = `Je bent een expert Google Ads optimizer voor Speed Rope Shop, een e-commerce shop voor speedropes en fitness accessoires actief in 6 landen (.com, .nl, .de, .fr, .es, .it).

Je helpt de gebruiker met vragen over campagnes, analyseert prestaties, en stelt concrete acties voor wanneer nodig.

## Regels
- Antwoord altijd in het Nederlands
- Stel NOOIT acties voor zonder eerst data op te halen en te analyseren via de beschikbare tools
- Bij het voorstellen van een actie (propose_action), leg altijd uit WAAROM
- Gebruik de exacte campagnenamen uit de database
- Headlines max 30 tekens, descriptions max 90 tekens (Google Ads limieten)
- Schrijf advertentieteksten in de taal van het land van de campagne`

  switch (contextType) {
    case 'campaign': {
      if (!contextId) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }
      const campaign = db.prepare(`
        SELECT c.*,
          (SELECT SUM(cost) FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as cost_7d,
          (SELECT SUM(conversion_value) FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as value_7d,
          (SELECT CASE WHEN SUM(cost) > 0 THEN SUM(conversion_value) / SUM(cost) ELSE 0 END FROM daily_metrics WHERE campaign_id = c.id AND date >= date('now', '-7 days')) as roas_7d
        FROM campaigns c WHERE c.id = ?
      `).get(contextId) as any
      if (!campaign) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }

      const context = `

## Huidige campagne context
- **Naam:** ${campaign.name}
- **Type:** ${campaign.type}
- **Status:** ${campaign.status}
- **Land:** ${campaign.country || 'onbekend'}
- **Target countries:** ${campaign.target_countries || 'niet ingesteld'}
- **Dagelijks budget:** €${campaign.daily_budget || 0}
- **ROAS (7d):** ${campaign.roas_7d?.toFixed(1) || '0.0'}x
- **Kosten (7d):** €${campaign.cost_7d?.toFixed(2) || '0.00'}
- **Omzet (7d):** €${campaign.value_7d?.toFixed(2) || '0.00'}
- **Database ID:** ${campaign.id} (gebruik dit voor tool-calls)`

      return {
        systemPrompt: baseRole + context,
        threadTitle: campaign.name,
      }
    }

    case 'suggestion': {
      if (!contextId) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }
      const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(contextId) as any
      if (!suggestion) return { systemPrompt: baseRole, threadTitle: 'AI Assistent' }

      let details: Record<string, unknown> = {}
      try { details = JSON.parse(suggestion.details) } catch { /* empty */ }

      // Try to find the campaign for extra context
      const campaignName = (details.campaign_name || details.name || '') as string
      let campaignContext = ''
      if (campaignName) {
        const camp = db.prepare('SELECT id, name, type, status, country, daily_budget FROM campaigns WHERE name LIKE ?').get(`%${campaignName}%`) as any
        if (camp) {
          campaignContext = `
- **Campagne:** ${camp.name} (ID: ${camp.id}, type: ${camp.type}, status: ${camp.status}, land: ${camp.country}, budget: €${camp.daily_budget})`
        }
      }

      const context = `

## Huidige suggestie context
- **Titel:** ${suggestion.title}
- **Type:** ${suggestion.type}
- **Prioriteit:** ${suggestion.priority}
- **Status:** ${suggestion.status}
- **Beschrijving:** ${suggestion.description}
- **Details:** ${JSON.stringify(details, null, 2)}${campaignContext}

De gebruiker wil deze suggestie bespreken. Help met vragen, geef extra context, of stel alternatieve acties voor indien nodig.`

      return {
        systemPrompt: baseRole + context,
        threadTitle: suggestion.title,
      }
    }

    case 'global':
    default: {
      const activeCampaigns = db.prepare(`
        SELECT c.id, c.name, c.type, c.status, c.country, c.daily_budget,
          CASE WHEN SUM(dm.cost) > 0 THEN SUM(dm.conversion_value) / SUM(dm.cost) ELSE 0 END as roas_7d
        FROM campaigns c
        LEFT JOIN daily_metrics dm ON dm.campaign_id = c.id AND dm.date >= date('now', '-7 days')
        WHERE c.status = 'ENABLED'
        GROUP BY c.id ORDER BY roas_7d DESC
      `).all()

      const context = `

## Actieve campagnes overzicht
${(activeCampaigns as any[]).map((c: any) => `- **${c.name}** (ID: ${c.id}) — ${c.type}, ${c.country || '?'}, budget €${c.daily_budget || 0}, ROAS 7d: ${c.roas_7d?.toFixed(1) || '0.0'}x`).join('\n')}

De gebruiker kan vragen stellen over elke campagne. Gebruik de tools om gedetailleerde data op te halen wanneer nodig.`

      return {
        systemPrompt: baseRole + context,
        threadTitle: 'AI Assistent',
      }
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add lib/chat-context.ts
git commit -m "feat(chat): add context builder for system prompts"
```

---

### Task 4: Chat API — streaming endpoint with tool use

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Create the streaming chat endpoint**

This is the core endpoint. It receives a message, loads/creates a thread, streams Claude's response with tool use back as Server-Sent Events.

```typescript
import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { requireAuth } from '@/lib/auth-guard'
import { log } from '@/lib/logger'
import { CHAT_TOOLS, executeTool } from '@/lib/chat-tools'
import { buildChatContext } from '@/lib/chat-context'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const body = await req.json()
  const { thread_id, context_type, context_id, message } = body as {
    thread_id: number | null
    context_type: string
    context_id: number | null
    message: string
  }

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Bericht is leeg' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Anthropic API key niet geconfigureerd' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const model = getSetting('ai_model') || 'claude-sonnet-4-6'
  const db = getDb()

  // Get or create thread
  let threadId = thread_id
  if (!threadId) {
    const { systemPrompt, threadTitle } = buildChatContext(context_type || 'global', context_id || null)
    const result = db.prepare(
      'INSERT INTO chat_threads (context_type, context_id, title) VALUES (?, ?, ?)'
    ).run(context_type || 'global', context_id || null, threadTitle)
    threadId = Number(result.lastInsertRowid)
    // Store system prompt reference — we rebuild it each time from context
  } else {
    // Verify thread exists
    const thread = db.prepare('SELECT id FROM chat_threads WHERE id = ?').get(threadId) as any
    if (!thread) {
      return new Response(JSON.stringify({ error: 'Thread niet gevonden' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
  }

  // Save user message
  db.prepare('INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)').run(threadId, 'user', message)
  db.prepare('UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(threadId)

  // Load thread context for system prompt
  const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId) as any
  const { systemPrompt } = buildChatContext(thread.context_type, thread.context_id)

  // Load last 20 messages for conversation history
  const history = db.prepare(
    'SELECT role, content, tool_calls FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(threadId) as Array<{ role: string; content: string; tool_calls: string | null }>
  history.reverse()

  // Build Anthropic messages from history
  const messages: Anthropic.MessageParam[] = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content || '',
  }))

  const client = new Anthropic({ apiKey })

  // Stream the response
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        let fullText = ''
        const proposedActions: Array<{ type: string; title: string; details: Record<string, unknown>; status: string }> = []
        let toolCallsLog: Array<{ name: string; input: Record<string, unknown> }> = []
        let inputTokens = 0
        let outputTokens = 0

        // Loop for tool use — Claude may call tools and then continue
        let currentMessages = [...messages]
        let maxIterations = 10 // safety limit

        while (maxIterations-- > 0) {
          const response = await client.messages.create({
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools: CHAT_TOOLS as any,
            stream: true,
          })

          let stopReason = ''
          let currentToolName = ''
          let currentToolInput = ''
          let currentToolId = ''
          let textChunk = ''

          for await (const event of response) {
            if (event.type === 'message_start' && event.message?.usage) {
              inputTokens += event.message.usage.input_tokens || 0
            }
            if (event.type === 'message_delta') {
              stopReason = (event as any).delta?.stop_reason || ''
              if ((event as any).usage) {
                outputTokens += (event as any).usage.output_tokens || 0
              }
            }
            if (event.type === 'content_block_start') {
              const block = (event as any).content_block
              if (block?.type === 'tool_use') {
                currentToolName = block.name
                currentToolId = block.id
                currentToolInput = ''
                send('tool_start', { name: currentToolName })
              }
            }
            if (event.type === 'content_block_delta') {
              const delta = (event as any).delta
              if (delta?.type === 'text_delta') {
                textChunk += delta.text
                fullText += delta.text
                send('text_delta', { text: delta.text })
              }
              if (delta?.type === 'input_json_delta') {
                currentToolInput += delta.partial_json
              }
            }
            if (event.type === 'content_block_stop' && currentToolName) {
              // Tool call completed — execute it
              let parsedInput: Record<string, unknown> = {}
              try { parsedInput = JSON.parse(currentToolInput) } catch { /* empty */ }

              toolCallsLog.push({ name: currentToolName, input: parsedInput })
              const { result, proposedAction } = executeTool(currentToolName, parsedInput)

              if (proposedAction) {
                const action = { ...proposedAction, status: 'pending' }
                proposedActions.push(action)
                send('proposed_action', action)
              }

              send('tool_result', { name: currentToolName })

              // Add tool result to messages for the next iteration
              // Build assistant message with the tool use block
              currentMessages = [
                ...currentMessages,
                {
                  role: 'assistant' as const,
                  content: [
                    ...(textChunk ? [{ type: 'text' as const, text: textChunk }] : []),
                    { type: 'tool_use' as const, id: currentToolId, name: currentToolName, input: parsedInput },
                  ],
                },
                {
                  role: 'user' as const,
                  content: [{ type: 'tool_result' as const, tool_use_id: currentToolId, content: result }],
                },
              ]
              textChunk = ''
              currentToolName = ''
              currentToolInput = ''
              currentToolId = ''
            }
          }

          // If Claude stopped because it wants to use another tool, loop
          if (stopReason === 'tool_use') {
            continue
          }

          // Otherwise we're done
          break
        }

        // Save assistant message to DB
        const msgResult = db.prepare(
          'INSERT INTO chat_messages (thread_id, role, content, tool_calls, proposed_actions) VALUES (?, ?, ?, ?, ?)'
        ).run(
          threadId,
          'assistant',
          fullText,
          toolCallsLog.length > 0 ? JSON.stringify(toolCallsLog) : null,
          proposedActions.length > 0 ? JSON.stringify(proposedActions) : null,
        )

        // Update thread title from first message if it's the default
        if (thread.title === 'AI Assistent' && message.length > 0) {
          const shortTitle = message.length > 50 ? message.slice(0, 47) + '...' : message
          db.prepare('UPDATE chat_threads SET title = ? WHERE id = ?').run(shortTitle, threadId)
        }

        // Log token usage
        db.prepare('INSERT INTO token_usage (call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
          .run('chat', model, inputTokens, outputTokens)

        send('done', { thread_id: threadId, message_id: Number(msgResult.lastInsertRowid) })
        controller.close()
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        log('error', 'chat', `Chat fout: ${errMsg}`)
        send('error', { message: errMsg })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(chat): add streaming chat API with tool use"
```

---

### Task 5: Thread API endpoints — list and read

**Files:**
- Create: `app/api/chat/threads/route.ts`
- Create: `app/api/chat/threads/[id]/route.ts`

- [ ] **Step 1: Create threads list endpoint**

Create `app/api/chat/threads/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const contextType = req.nextUrl.searchParams.get('context_type')
  const contextId = req.nextUrl.searchParams.get('context_id')

  const db = getDb()
  let sql = 'SELECT * FROM chat_threads WHERE 1=1'
  const params: unknown[] = []

  if (contextType) {
    sql += ' AND context_type = ?'
    params.push(contextType)
  }
  if (contextId) {
    sql += ' AND context_id = ?'
    params.push(Number(contextId))
  }

  sql += ' ORDER BY updated_at DESC LIMIT 50'

  const threads = db.prepare(sql).all(...params)
  return NextResponse.json({ threads })
}
```

- [ ] **Step 2: Create thread messages endpoint**

Create `app/api/chat/threads/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { id } = await ctx.params
  const db = getDb()

  const thread = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id)
  if (!thread) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })

  const messages = db.prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC'
  ).all(id)

  return NextResponse.json({ thread, messages })
}
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds with the new routes listed

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/threads/route.ts app/api/chat/threads/\[id\]/route.ts
git commit -m "feat(chat): add thread list and messages API endpoints"
```

---

### Task 6: Apply Action endpoint — execute proposed actions from chat

**Files:**
- Create: `app/api/chat/apply-action/route.ts`

- [ ] **Step 1: Create the apply-action endpoint**

This endpoint reads a proposed_action from a chat message and runs it through the existing action-engine.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'
import { log } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  const { message_id, action_index } = await req.json() as { message_id: number; action_index: number }

  const db = getDb()
  const message = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(message_id) as any
  if (!message) return NextResponse.json({ error: 'Bericht niet gevonden' }, { status: 404 })
  if (!message.proposed_actions) return NextResponse.json({ error: 'Geen acties in dit bericht' }, { status: 400 })

  const actions = JSON.parse(message.proposed_actions) as Array<{ type: string; title: string; details: Record<string, unknown>; status: string }>
  if (action_index < 0 || action_index >= actions.length) return NextResponse.json({ error: 'Ongeldige actie index' }, { status: 400 })

  const action = actions[action_index]
  if (action.status !== 'pending') return NextResponse.json({ error: `Actie is al ${action.status}` }, { status: 400 })

  try {
    // Import action engine functions
    const { getGoogleAdsClient } = await import('@/lib/google-ads')
    const { getSetting } = await import('@/lib/settings')

    const customerId = getSetting('google_ads_customer_id')
    if (!customerId) throw new Error('Google Ads customer ID niet geconfigureerd')

    const details = { ...action.details, customer_id: customerId }

    // Resolve campaign/adgroup IDs from names (same logic as action-engine)
    if (details.campaign_name && !details.google_campaign_id) {
      const camp = db.prepare('SELECT google_campaign_id, daily_budget FROM campaigns WHERE name LIKE ?').get(`%${details.campaign_name}%`) as any
      if (camp) {
        details.google_campaign_id = camp.google_campaign_id
        if (!details.old_budget) details.old_budget = camp.daily_budget
      }
    }
    if (details.adgroup_name && !details.google_adgroup_id) {
      const ag = db.prepare('SELECT google_adgroup_id FROM ad_groups WHERE name LIKE ?').get(`%${details.adgroup_name}%`) as any
      if (ag) details.google_adgroup_id = ag.google_adgroup_id
    }

    // Execute via Google Ads API based on type
    let googleResponse: unknown = null
    const customer = getGoogleAdsClient()

    switch (action.type) {
      case 'budget_change': {
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden')
        const [campaign] = await customer.query(`SELECT campaign.id, campaign_budget.resource_name FROM campaign WHERE campaign.id = ${details.google_campaign_id} LIMIT 1`)
        if (!campaign?.campaign_budget?.resource_name) throw new Error('Budget resource niet gevonden')
        googleResponse = await customer.mutateResources([{
          entity: 'campaign_budget', operation: 'update',
          resource: { resource_name: campaign.campaign_budget.resource_name, amount_micros: Math.round(((details.new_budget as number) || 0) * 1_000_000) },
        }])
        break
      }
      case 'keyword_negative': {
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden')
        googleResponse = await customer.mutateResources([{
          entity: 'campaign_criterion', operation: 'create',
          resource: {
            campaign: `customers/${customerId}/campaigns/${details.google_campaign_id}`,
            negative: true,
            keyword: { text: details.keyword as string, match_type: (details.match_type as string) || 'EXACT' },
          },
        }])
        break
      }
      case 'pause_campaign': {
        if (!details.google_campaign_id) throw new Error('Campagne niet gevonden')
        googleResponse = await customer.mutateResources([{
          entity: 'campaign', operation: 'update',
          resource: { resource_name: `customers/${customerId}/campaigns/${details.google_campaign_id}`, status: 'PAUSED' },
        }])
        break
      }
      case 'bid_adjustment': {
        if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden')
        googleResponse = await customer.mutateResources([{
          entity: 'ad_group_criterion', operation: 'update',
          resource: {
            resource_name: `customers/${customerId}/adGroupCriteria/${details.google_adgroup_id}~${details.criterion_id}`,
            cpc_bid_micros: Math.round(((details.new_bid as number) || 0) * 1_000_000),
          },
        }])
        break
      }
      case 'keyword_add': {
        if (!details.google_adgroup_id) throw new Error('Ad group niet gevonden')
        const keywords = Array.isArray(details.keywords) ? details.keywords : [details.keyword]
        googleResponse = await customer.mutateResources(keywords.map((kw: string) => ({
          entity: 'ad_group_criterion' as const, operation: 'create' as const,
          resource: {
            ad_group: `customers/${customerId}/adGroups/${details.google_adgroup_id}`,
            keyword: { text: kw, match_type: (details.match_type as string) || 'PHRASE' },
          },
        })))
        break
      }
      default:
        log('warn', 'chat', `Chat actie type niet ondersteund voor directe uitvoering: ${action.type}`)
    }

    // Update action status in the message
    actions[action_index].status = 'applied'
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?').run(JSON.stringify(actions), message_id)

    // Log in action_log
    db.prepare(`
      INSERT INTO action_log (action_type, description, old_value, new_value, applied_by, google_response)
      VALUES (?, ?, ?, ?, 'manual', ?)
    `).run(action.type, action.title, null, JSON.stringify(action.details), JSON.stringify(googleResponse))

    log('info', 'chat', `Chat actie toegepast: ${action.title}`, { type: action.type })
    return NextResponse.json({ success: true })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    log('error', 'chat', `Chat actie mislukt: ${errMsg}`)

    // Mark as failed
    actions[action_index].status = 'failed'
    db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?').run(JSON.stringify(actions), message_id)

    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/apply-action/route.ts
git commit -m "feat(chat): add apply-action endpoint for chat-proposed actions"
```

---

### Task 7: ChatMessage component — message rendering with action cards

**Files:**
- Create: `components/ChatMessage.tsx`

- [ ] **Step 1: Create ChatMessage component**

```typescript
'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'

interface ProposedAction {
  type: string
  title: string
  details: Record<string, unknown>
  status: string
}

interface ChatMessageProps {
  id?: number
  role: 'user' | 'assistant'
  content: string
  proposedActions?: ProposedAction[]
  toolCalls?: Array<{ name: string }>
  onActionApplied?: () => void
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  budget_change: 'Budget wijziging',
  bid_adjustment: 'Bod aanpassing',
  keyword_negative: 'Negatief zoekwoord',
  pause_campaign: 'Campagne pauzeren',
  keyword_add: 'Zoekwoord toevoegen',
  ad_text_change: 'Advertentie wijzigen',
  new_campaign: 'Nieuwe campagne',
  schedule_change: 'Schema wijzigen',
}

function ActionCard({ messageId, action, index, onApplied }: {
  messageId: number
  action: ProposedAction
  index: number
  onApplied?: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleApply() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/chat/apply-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, action_index: index }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Fout bij toepassen')
      }
      onApplied?.()
    } finally {
      setLoading(false)
    }
  }

  async function handleDismiss() {
    setLoading(true)
    try {
      // Update status locally via API — we reuse apply-action but mark as dismissed
      // For now, we'll just mark it client-side and save
      const res = await apiFetch('/api/chat/apply-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId, action_index: index, dismiss: true }),
      })
      onApplied?.()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 bg-surface-0 border border-border-subtle rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent-subtle text-accent">
          {ACTION_TYPE_LABELS[action.type] || action.type}
        </span>
        {action.status === 'applied' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-success-subtle text-success">Toegepast</span>
        )}
        {action.status === 'failed' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-danger-subtle text-danger">Mislukt</span>
        )}
        {action.status === 'dismissed' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-surface-2 text-text-tertiary">Genegeerd</span>
        )}
      </div>
      <div className="text-[13px] font-medium text-text-primary">{action.title}</div>
      <div className="text-[11px] text-text-tertiary mt-1 font-mono">
        {Object.entries(action.details).map(([k, v]) => (
          <div key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
        ))}
      </div>
      {action.status === 'pending' && (
        <div className="flex gap-2 mt-2">
          <button onClick={handleApply} disabled={loading}
            className="px-3 py-1 bg-accent text-white text-[11px] font-semibold rounded-lg hover:bg-accent-hover disabled:opacity-50">
            {loading ? '...' : 'Pas toe'}
          </button>
          <button onClick={handleDismiss} disabled={loading}
            className="px-3 py-1 text-text-tertiary text-[11px] font-medium rounded-lg hover:bg-surface-2 disabled:opacity-50">
            Negeer
          </button>
        </div>
      )}
    </div>
  )
}

export default function ChatMessage({ id, role, content, proposedActions, toolCalls, onActionApplied }: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-accent text-white rounded-2xl rounded-br-md px-3.5 py-2 text-[13px]">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div className="bg-surface-1 border border-border-subtle rounded-2xl rounded-bl-md px-3.5 py-2 text-[13px] text-text-primary whitespace-pre-wrap">
          {content}
        </div>
        {proposedActions?.map((action, i) => (
          <ActionCard key={i} messageId={id!} action={action} index={i} onApplied={onActionApplied} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add components/ChatMessage.tsx
git commit -m "feat(chat): add ChatMessage component with action cards"
```

---

### Task 8: ChatPanel component — slide-over and floating UI

**Files:**
- Create: `components/ChatPanel.tsx`

- [ ] **Step 1: Create ChatPanel component**

This is the main chat UI. Slide-over on desktop (>768px), floating popup on mobile.

```typescript
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import ChatMessage from './ChatMessage'

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  proposed_actions?: string | null
  tool_calls?: string | null
}

interface ChatPanelProps {
  contextType: string
  contextId: number | null
  title?: string
  onClose: () => void
}

export default function ChatPanel({ contextType, contextId, title, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [threadId, setThreadId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load existing thread
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ context_type: contextType })
    if (contextId) params.set('context_id', String(contextId))

    apiFetch(`/api/chat/threads?${params}`)
      .then(r => r.json())
      .then(data => {
        const threads = data.threads || []
        if (threads.length > 0) {
          const latest = threads[0]
          setThreadId(latest.id)
          return apiFetch(`/api/chat/threads/${latest.id}`).then(r => r.json())
        }
        return null
      })
      .then(data => {
        if (data?.messages) {
          setMessages(data.messages)
        }
        setLoading(false)
        setTimeout(scrollToBottom, 100)
      })
      .catch(() => setLoading(false))
  }, [contextType, contextId, scrollToBottom])

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return

    setInput('')
    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)
    setTimeout(scrollToBottom, 50)

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: threadId,
          context_type: contextType,
          context_id: contextId,
          message: text,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', content: `Fout: ${err.error || 'Onbekende fout'}` }])
        setStreaming(false)
        return
      }

      // Read SSE stream
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      let assistantActions: any[] = []
      let newMessageId: number | undefined
      let buffer = ''

      // Add placeholder assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim()
            // Next line should be data
            continue
          }
          if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            let data: any
            try { data = JSON.parse(raw) } catch { continue }

            // Determine event type from the previous event line
            // We need to track event type properly
            if (data.text !== undefined) {
              // text_delta
              assistantText += data.text
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: assistantText }
                }
                return updated
              })
              scrollToBottom()
            } else if (data.name !== undefined && data.type === undefined && data.title === undefined) {
              // tool_start or tool_result
              if (!data.text) {
                setToolStatus(data.name ? `${toolLabel(data.name)}...` : null)
              }
            } else if (data.type !== undefined && data.title !== undefined) {
              // proposed_action
              assistantActions.push(data)
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    proposed_actions: JSON.stringify(assistantActions),
                  }
                }
                return updated
              })
              scrollToBottom()
            } else if (data.thread_id !== undefined) {
              // done
              setThreadId(data.thread_id)
              newMessageId = data.message_id
              setToolStatus(null)
              // Update last message with the real ID
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, id: newMessageId }
                }
                return updated
              })
            } else if (data.message !== undefined && !data.text) {
              // error
              assistantText += `\n\nFout: ${data.message}`
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: assistantText }
                }
                return updated
              })
            }
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Fout: ${e instanceof Error ? e.message : 'Verbinding mislukt'}` }])
    } finally {
      setStreaming(false)
      setToolStatus(null)
      scrollToBottom()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function refreshMessages() {
    if (!threadId) return
    apiFetch(`/api/chat/threads/${threadId}`)
      .then(r => r.json())
      .then(data => { if (data?.messages) setMessages(data.messages) })
  }

  const displayTitle = title || 'AI Assistent'

  return (
    <>
      {/* Desktop: slide-over overlay */}
      <div className="fixed inset-0 z-50 hidden md:flex justify-end" onClick={onClose}>
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative w-[420px] h-full bg-surface-0 border-l border-border-subtle shadow-2xl flex flex-col animate-slide-in-right"
          onClick={e => e.stopPropagation()}>
          <ChatContent
            displayTitle={displayTitle} onClose={onClose}
            messages={messages} input={input} setInput={setInput}
            streaming={streaming} loading={loading} toolStatus={toolStatus}
            sendMessage={sendMessage} handleKeyDown={handleKeyDown}
            scrollToBottom={scrollToBottom} refreshMessages={refreshMessages}
            messagesEndRef={messagesEndRef} inputRef={inputRef}
          />
        </div>
      </div>

      {/* Mobile: full-screen popup */}
      <div className="fixed inset-0 z-50 flex md:hidden flex-col bg-surface-0 animate-slide-up">
        <ChatContent
          displayTitle={displayTitle} onClose={onClose}
          messages={messages} input={input} setInput={setInput}
          streaming={streaming} loading={loading} toolStatus={toolStatus}
          sendMessage={sendMessage} handleKeyDown={handleKeyDown}
          scrollToBottom={scrollToBottom} refreshMessages={refreshMessages}
          messagesEndRef={messagesEndRef} inputRef={inputRef}
        />
      </div>
    </>
  )
}

function ChatContent({ displayTitle, onClose, messages, input, setInput, streaming, loading, toolStatus, sendMessage, handleKeyDown, scrollToBottom, refreshMessages, messagesEndRef, inputRef }: {
  displayTitle: string; onClose: () => void
  messages: Message[]; input: string; setInput: (v: string) => void
  streaming: boolean; loading: boolean; toolStatus: string | null
  sendMessage: () => void; handleKeyDown: (e: React.KeyboardEvent) => void
  scrollToBottom: () => void; refreshMessages: () => void
  messagesEndRef: React.RefObject<HTMLDivElement | null>; inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
        <div className="w-7 h-7 bg-accent/10 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <span className="text-[14px] font-semibold text-text-primary flex-1 truncate">{displayTitle}</span>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-2 text-text-tertiary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-[24px] mb-2 opacity-40">💬</div>
            <div className="text-[13px] text-text-tertiary">Stel een vraag over je campagnes</div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessage
              key={msg.id || i}
              id={msg.id}
              role={msg.role as 'user' | 'assistant'}
              content={msg.content || ''}
              proposedActions={msg.proposed_actions ? JSON.parse(msg.proposed_actions) : undefined}
              toolCalls={msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined}
              onActionApplied={refreshMessages}
            />
          ))
        )}
        {toolStatus && (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
            {toolStatus}
          </div>
        )}
        {streaming && !toolStatus && (
          <div className="flex items-center gap-1 pl-1">
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border-subtle shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Stel een vraag..."
            rows={1}
            className="flex-1 bg-surface-1 text-text-primary text-[13px] px-3 py-2.5 rounded-xl outline-none border border-border hover:border-text-tertiary focus:border-accent placeholder:text-text-tertiary transition-colors resize-none"
          />
          <button onClick={sendMessage} disabled={streaming || !input.trim()}
            className="px-3 py-2.5 bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </div>
      </div>
    </>
  )
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    get_campaign_metrics: 'Metrics ophalen',
    get_keywords: 'Zoekwoorden ophalen',
    get_search_terms: 'Zoekopdrachten ophalen',
    get_ad_texts: 'Advertenties ophalen',
    get_products: 'Producten ophalen',
    get_suggestions: 'Suggesties ophalen',
    propose_action: 'Actie voorstellen',
  }
  return labels[name] || name
}
```

- [ ] **Step 2: Add slide-in animations to global CSS**

Check the global CSS file for existing animations. Add these if not present. The file is likely `app/globals.css`.

Add at the end of the file:

```css
@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.animate-slide-in-right {
  animation: slide-in-right 0.2s ease-out;
}

@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 0.2s ease-out;
}
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add components/ChatPanel.tsx app/globals.css
git commit -m "feat(chat): add ChatPanel component with slide-over and mobile UI"
```

---

### Task 9: ChatProvider — global state for chat open/close

**Files:**
- Create: `components/ChatProvider.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create ChatProvider**

```typescript
'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import ChatPanel from './ChatPanel'

interface ChatState {
  isOpen: boolean
  contextType: string
  contextId: number | null
  title?: string
}

interface ChatContextValue {
  openChat: (contextType: string, contextId?: number | null, title?: string) => void
  closeChat: () => void
  isOpen: boolean
}

const ChatContext = createContext<ChatContextValue>({
  openChat: () => {},
  closeChat: () => {},
  isOpen: false,
})

export function useChatPanel() {
  return useContext(ChatContext)
}

export default function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>({
    isOpen: false,
    contextType: 'global',
    contextId: null,
  })

  const openChat = useCallback((contextType: string, contextId?: number | null, title?: string) => {
    setState({ isOpen: true, contextType, contextId: contextId ?? null, title })
  }, [])

  const closeChat = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }))
  }, [])

  return (
    <ChatContext value={{ openChat, closeChat, isOpen: state.isOpen }}>
      {children}
      {state.isOpen && (
        <ChatPanel
          contextType={state.contextType}
          contextId={state.contextId}
          title={state.title}
          onClose={closeChat}
        />
      )}
    </ChatContext>
  )
}
```

- [ ] **Step 2: Wrap layout.tsx with ChatProvider**

Read `app/layout.tsx` and wrap the children inside the body with `<ChatProvider>`. The exact edit depends on the file contents — wrap `{children}` (or whatever is inside `<body>`) with:

```tsx
import ChatProvider from '@/components/ChatProvider'
// ... in the body:
<ChatProvider>
  {children}
</ChatProvider>
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add components/ChatProvider.tsx app/layout.tsx
git commit -m "feat(chat): add ChatProvider for global chat state"
```

---

### Task 10: Integration — add chat buttons to Nav, SuggestionCard, and CampaignDetail

**Files:**
- Modify: `components/Nav.tsx`
- Modify: `components/SuggestionCard.tsx`
- Modify: `app/campaigns/[id]/page.tsx`

- [ ] **Step 1: Add AI chat button to Nav**

In `components/Nav.tsx`, add the chat button between the sync button and settings icon. Import and use the chat context:

Add import at top:
```typescript
import { useChatPanel } from './ChatProvider'
```

Inside the Nav component, before the return:
```typescript
const { openChat } = useChatPanel()
```

Add this button between the "Sync nu" button and the settings Link (inside `<div className="ml-auto flex items-center gap-2">`):

```tsx
<button onClick={() => openChat('global', null, 'AI Assistent')}
  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-2 text-text-tertiary transition-colors"
  title="AI Chat">
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
  </svg>
</button>
```

- [ ] **Step 2: Add "Bespreek" button to SuggestionCard**

In `components/SuggestionCard.tsx`, add import:
```typescript
import { useChatPanel } from './ChatProvider'
```

Inside the SuggestionCard component, add:
```typescript
const { openChat } = useChatPanel()
```

In the `{status === 'pending' && (` section, add a "Bespreek" button after the "Negeer" button:
```tsx
<button onClick={() => openChat('suggestion', id, title)}
  className="px-3 py-1.5 text-accent text-[12px] font-medium rounded-lg hover:bg-accent-subtle disabled:opacity-50">
  Bespreek
</button>
```

Also add this same button for `applied` and `dismissed` suggestions so users can always discuss any suggestion. Add it after the status badge sections:

After the `{status === 'applied' && (` div and after the `{status === 'dismissed' && (` span, add at the same level:

```tsx
{status !== 'pending' && (
  <button onClick={() => openChat('suggestion', id, title)}
    className="text-[11px] text-accent hover:underline mt-2">
    Bespreek met AI
  </button>
)}
```

- [ ] **Step 3: Add "Vraag AI" button to campaign detail page**

In `app/campaigns/[id]/page.tsx`, add import:
```typescript
import { useChatPanel } from '@/components/ChatProvider'
```

Inside the component, add:
```typescript
const { openChat } = useChatPanel()
```

In the header section (the `<div className="flex items-center gap-3 mb-5">` div), add this button at the end, after the campaign type/target_countries span:

```tsx
<button onClick={() => openChat('campaign', campaign.id, campaign.name)}
  className="px-3 py-1.5 bg-accent/10 text-accent text-[12px] font-semibold rounded-lg hover:bg-accent/20 transition-colors shrink-0">
  Vraag AI
</button>
```

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add components/Nav.tsx components/SuggestionCard.tsx app/campaigns/\[id\]/page.tsx
git commit -m "feat(chat): add chat buttons to Nav, SuggestionCard, and campaign detail"
```

---

### Task 11: Apply-action dismiss support and SSE event parsing fix

**Files:**
- Modify: `app/api/chat/apply-action/route.ts`
- Modify: `components/ChatPanel.tsx`

- [ ] **Step 1: Add dismiss support to apply-action endpoint**

In `app/api/chat/apply-action/route.ts`, after parsing the request body, add dismiss handling. Change the destructuring line to:

```typescript
const { message_id, action_index, dismiss } = await req.json() as { message_id: number; action_index: number; dismiss?: boolean }
```

After the existing `if (action.status !== 'pending')` check, add:

```typescript
if (dismiss) {
  actions[action_index].status = 'dismissed'
  db.prepare('UPDATE chat_messages SET proposed_actions = ? WHERE id = ?').run(JSON.stringify(actions), message_id)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Fix SSE event parsing in ChatPanel**

The current SSE parsing in ChatPanel needs to properly track event types. Replace the SSE reading section (the `while (true)` loop) in the `sendMessage` function with a proper event/data pairing:

In `components/ChatPanel.tsx`, replace the SSE parsing block (the section from `let buffer = ''` through the end of the `while (true)` reading loop) with:

```typescript
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
            continue
          }
          if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            let data: any
            try { data = JSON.parse(raw) } catch { continue }

            switch (currentEvent) {
              case 'text_delta':
                assistantText += data.text
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: assistantText }
                  }
                  return updated
                })
                scrollToBottom()
                break

              case 'tool_start':
                setToolStatus(data.name ? `${toolLabel(data.name)}...` : null)
                break

              case 'tool_result':
                setToolStatus(null)
                break

              case 'proposed_action':
                assistantActions.push(data)
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, proposed_actions: JSON.stringify(assistantActions) }
                  }
                  return updated
                })
                scrollToBottom()
                break

              case 'done':
                setThreadId(data.thread_id)
                newMessageId = data.message_id
                setToolStatus(null)
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, id: newMessageId }
                  }
                  return updated
                })
                break

              case 'error':
                assistantText += `\n\nFout: ${data.message}`
                setMessages(prev => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: assistantText }
                  }
                  return updated
                })
                break
            }
            currentEvent = ''
          }
        }
      }
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/apply-action/route.ts components/ChatPanel.tsx
git commit -m "feat(chat): add dismiss support and fix SSE event parsing"
```

---

### Task 12: Final integration — verify everything works end-to-end

- [ ] **Step 1: Full build check**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds with all new routes listed:
- `/api/chat`
- `/api/chat/apply-action`
- `/api/chat/threads`
- `/api/chat/threads/[id]`

- [ ] **Step 2: Verify all new files exist**

```bash
ls -la lib/chat-tools.ts lib/chat-context.ts
ls -la components/ChatPanel.tsx components/ChatMessage.tsx components/ChatProvider.tsx
ls -la app/api/chat/route.ts app/api/chat/apply-action/route.ts app/api/chat/threads/route.ts "app/api/chat/threads/[id]/route.ts"
```

- [ ] **Step 3: Final commit and push**

```bash
git add -A
git status
git push
```
