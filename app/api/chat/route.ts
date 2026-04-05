import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDb } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { requireAuth } from '@/lib/auth-guard'
import { buildChatContext } from '@/lib/chat-context'
import { CHAT_TOOLS, executeTool } from '@/lib/chat-tools'
import { log } from '@/lib/logger'

const MAX_TOOL_ITERATIONS = 10

interface ChatRequestBody {
  thread_id?: number
  context_type: string
  context_id?: number | null
  message: string
}

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req)
  if (denied) return denied

  let body: ChatRequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(
      sseEvent('error', { message: 'Ongeldige JSON' }),
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const { context_type, context_id, message } = body
  let { thread_id } = body

  if (!message || typeof message !== 'string') {
    return new Response(
      sseEvent('error', { message: 'Bericht is verplicht' }),
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const apiKey = getSetting('anthropic_api_key')
  if (!apiKey) {
    return new Response(
      sseEvent('error', { message: 'Anthropic API key niet ingesteld' }),
      { status: 500, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const model = getSetting('ai_model') || 'claude-sonnet-4-20250514'
  const db = getDb()

  // Get or create thread
  if (thread_id) {
    const existing = db.prepare('SELECT id FROM chat_threads WHERE id = ?').get(thread_id) as { id: number } | undefined
    if (!existing) {
      thread_id = undefined
    }
  }

  if (!thread_id) {
    const result = db.prepare(
      'INSERT INTO chat_threads (context_type, context_id, title) VALUES (?, ?, ?)'
    ).run(context_type || 'global', context_id ?? null, 'AI Assistent')
    thread_id = result.lastInsertRowid as number
  }

  // Update thread title if still default
  const thread = db.prepare('SELECT title FROM chat_threads WHERE id = ?').get(thread_id) as { title: string }
  if (thread.title === 'AI Assistent' && message.trim()) {
    const truncated = message.trim().substring(0, 50) + (message.trim().length > 50 ? '...' : '')
    db.prepare('UPDATE chat_threads SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(truncated, thread_id)
  } else {
    db.prepare('UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thread_id)
  }

  // Save user message
  const userMsgResult = db.prepare(
    'INSERT INTO chat_messages (thread_id, role, content) VALUES (?, ?, ?)'
  ).run(thread_id, 'user', message)

  // Load last 20 messages for history
  const historyRows = db.prepare(
    'SELECT role, content, tool_calls FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 20'
  ).all(thread_id) as Array<{ role: string; content: string | null; tool_calls: string | null }>

  // Reverse to chronological order
  historyRows.reverse()

  // Build Anthropic messages from history
  const anthropicMessages: Anthropic.MessageParam[] = []
  for (const row of historyRows) {
    if (row.role === 'user') {
      anthropicMessages.push({ role: 'user', content: row.content || '' })
    } else if (row.role === 'assistant') {
      // If there are tool_calls, reconstruct the content blocks
      if (row.tool_calls) {
        try {
          const toolCalls = JSON.parse(row.tool_calls) as Array<{
            id: string; name: string; input: Record<string, unknown>; result: string
          }>
          const contentBlocks: Anthropic.ContentBlockParam[] = []
          if (row.content) {
            contentBlocks.push({ type: 'text', text: row.content })
          }
          for (const tc of toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })
          }
          anthropicMessages.push({ role: 'assistant', content: contentBlocks })
          // Add tool results
          const toolResults: Anthropic.ToolResultBlockParam[] = toolCalls.map(tc => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: tc.result,
          }))
          anthropicMessages.push({ role: 'user', content: toolResults })
        } catch {
          anthropicMessages.push({ role: 'assistant', content: row.content || '' })
        }
      } else {
        anthropicMessages.push({ role: 'assistant', content: row.content || '' })
      }
    }
  }

  // Build system prompt
  const { systemPrompt } = buildChatContext(context_type || 'global', context_id ?? null)

  const client = new Anthropic({ apiKey })

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let fullAssistantText = ''
        const allToolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; result: string }> = []
        const proposedActions: Array<{ type: string; title: string; details: Record<string, unknown> }> = []

        let currentMessages = [...anthropicMessages]
        let iterations = 0

        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++

          // Collect tool use blocks during streaming
          const pendingToolUses: Array<{ id: string; name: string; inputJson: string }> = []
          let currentToolUseIndex = -1
          let stopReason: string | null = null

          const response = await client.messages.create({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: CHAT_TOOLS as Anthropic.Tool[],
            stream: true,
          })

          for await (const event of response) {
            if (event.type === 'message_start') {
              totalInputTokens += event.message.usage?.input_tokens || 0
            } else if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                currentToolUseIndex = pendingToolUses.length
                pendingToolUses.push({
                  id: event.content_block.id,
                  name: event.content_block.name,
                  inputJson: '',
                })
                controller.enqueue(
                  new TextEncoder().encode(
                    sseEvent('tool_start', { name: event.content_block.name })
                  )
                )
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                fullAssistantText += event.delta.text
                controller.enqueue(
                  new TextEncoder().encode(
                    sseEvent('text_delta', { text: event.delta.text })
                  )
                )
              } else if (event.delta.type === 'input_json_delta') {
                if (currentToolUseIndex >= 0) {
                  pendingToolUses[currentToolUseIndex].inputJson += event.delta.partial_json
                }
              }
            } else if (event.type === 'content_block_stop') {
              // Reset tool index tracking
              if (currentToolUseIndex >= 0) {
                currentToolUseIndex = -1
              }
            } else if (event.type === 'message_delta') {
              totalOutputTokens += event.usage?.output_tokens || 0
              stopReason = event.delta?.stop_reason || null
            }
          }

          // If Claude wants to use tools, execute them and loop
          if (stopReason === 'tool_use' && pendingToolUses.length > 0) {
            // Build assistant content blocks for this turn
            const assistantContent: Anthropic.ContentBlockParam[] = []
            if (fullAssistantText) {
              // Only include text from this iteration
              assistantContent.push({ type: 'text', text: fullAssistantText })
            }

            const toolResults: Anthropic.ToolResultBlockParam[] = []

            for (const toolUse of pendingToolUses) {
              let toolInput: Record<string, unknown> = {}
              try {
                toolInput = toolUse.inputJson ? JSON.parse(toolUse.inputJson) : {}
              } catch {
                toolInput = {}
              }

              assistantContent.push({
                type: 'tool_use',
                id: toolUse.id,
                name: toolUse.name,
                input: toolInput,
              })

              // Execute tool
              const { result, proposedAction } = executeTool(toolUse.name, toolInput)

              allToolCalls.push({
                id: toolUse.id,
                name: toolUse.name,
                input: toolInput,
                result,
              })

              controller.enqueue(
                new TextEncoder().encode(
                  sseEvent('tool_result', { name: toolUse.name })
                )
              )

              if (proposedAction) {
                proposedActions.push(proposedAction)
                controller.enqueue(
                  new TextEncoder().encode(
                    sseEvent('proposed_action', {
                      type: proposedAction.type,
                      title: proposedAction.title,
                      details: proposedAction.details,
                      status: 'pending',
                    })
                  )
                )
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: result,
              })
            }

            // Add assistant + tool results to messages for next iteration
            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: assistantContent },
              { role: 'user', content: toolResults },
            ]

            // Reset text for next iteration
            fullAssistantText = ''
          } else {
            // Done - no more tool calls
            break
          }
        }

        // Save assistant message to DB
        const msgResult = db.prepare(
          'INSERT INTO chat_messages (thread_id, role, content, tool_calls, proposed_actions) VALUES (?, ?, ?, ?, ?)'
        ).run(
          thread_id,
          'assistant',
          fullAssistantText || null,
          allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
          proposedActions.length > 0 ? JSON.stringify(proposedActions) : null,
        )

        // Log token usage
        db.prepare(
          'INSERT INTO token_usage (call_type, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)'
        ).run('chat', model, totalInputTokens, totalOutputTokens)

        log('info', 'ai', `Chat response: ${totalInputTokens} in / ${totalOutputTokens} out tokens`, {
          thread_id,
          model,
          tool_calls: allToolCalls.length,
        })

        // Send done event
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent('done', {
              thread_id,
              message_id: Number(msgResult.lastInsertRowid),
            })
          )
        )

        controller.close()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Onbekende fout'
        log('error', 'ai', `Chat error: ${errorMessage}`, { thread_id })
        try {
          controller.enqueue(
            new TextEncoder().encode(
              sseEvent('error', { message: errorMessage })
            )
          )
        } catch {
          // Controller may already be closed
        }
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
