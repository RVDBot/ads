'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import ChatMessage from '@/components/ChatMessage'

interface ChatPanelProps {
  contextType: string
  contextId: number | null
  title?: string
  onClose: () => void
}

interface Message {
  id?: number
  role: 'user' | 'assistant'
  content: string
  proposedActions?: Array<{ type: string; title: string; details: Record<string, unknown>; status: string }>
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

export default function ChatPanel({ contextType, contextId, title, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [threadId, setThreadId] = useState<number | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Load existing thread on mount
  useEffect(() => {
    async function loadThread() {
      try {
        const params = new URLSearchParams({ context_type: contextType })
        if (contextId != null) params.set('context_id', String(contextId))
        const res = await apiFetch(`/api/chat/threads?${params}`)
        if (!res.ok) return
        const threads = await res.json()
        if (threads.length === 0) return
        const latest = threads[0]
        setThreadId(latest.id)
        const msgRes = await apiFetch(`/api/chat/threads/${latest.id}`)
        if (!msgRes.ok) return
        const data = await msgRes.json()
        setMessages(data.messages || [])
      } catch {
        // ignore load errors
      }
    }
    loadThread()
  }, [contextType, contextId])

  async function refreshMessages() {
    if (!threadId) return
    try {
      const res = await apiFetch(`/api/chat/threads/${threadId}`)
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages || [])
    } catch {
      // ignore
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming) return

    const userMessage: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setStreaming(true)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const assistantMessage: Message = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMessage])
    const assistantIndex = messages.length + 1 // index of the new assistant message

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

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const updated = [...prev]
          updated[assistantIndex] = { ...updated[assistantIndex], content: 'Er ging iets mis. Probeer het opnieuw.' }
          return updated
        })
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'text_delta'

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
            const data = line.slice(6)
            processSSE(currentEvent, data, assistantIndex)
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n')
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6)
            processSSE(currentEvent, data, assistantIndex)
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[assistantIndex] = { ...updated[assistantIndex], content: updated[assistantIndex].content || 'Verbinding mislukt.' }
        return updated
      })
    } finally {
      setStreaming(false)
      setToolStatus(null)
    }
  }

  function processSSE(event: string, data: string, assistantIndex: number) {
    switch (event) {
      case 'text_delta':
        setMessages(prev => {
          const updated = [...prev]
          updated[assistantIndex] = {
            ...updated[assistantIndex],
            content: updated[assistantIndex].content + data,
          }
          return updated
        })
        break
      case 'tool_start':
        try {
          const parsed = JSON.parse(data)
          setToolStatus(toolLabel(parsed.name || parsed.tool || ''))
        } catch {
          setToolStatus('Verwerken...')
        }
        break
      case 'tool_result':
        setToolStatus(null)
        break
      case 'proposed_action':
        try {
          const action = JSON.parse(data)
          setMessages(prev => {
            const updated = [...prev]
            const msg = updated[assistantIndex]
            updated[assistantIndex] = {
              ...msg,
              proposedActions: [...(msg.proposedActions || []), action],
            }
            return updated
          })
        } catch {
          // ignore parse errors
        }
        break
      case 'done':
        try {
          const parsed = JSON.parse(data)
          if (parsed.thread_id) setThreadId(parsed.thread_id)
          if (parsed.message_id) {
            setMessages(prev => {
              const updated = [...prev]
              updated[assistantIndex] = { ...updated[assistantIndex], id: parsed.message_id }
              return updated
            })
          }
        } catch {
          // ignore
        }
        break
      case 'error':
        setMessages(prev => {
          const updated = [...prev]
          updated[assistantIndex] = {
            ...updated[assistantIndex],
            content: updated[assistantIndex].content + '\n\n⚠ ' + data,
          }
          return updated
        })
        break
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <>
      {/* Desktop: slide-over with overlay */}
      <div className="hidden md:flex fixed inset-0 z-50">
        <div className="flex-1 bg-black/30" onClick={onClose} />
        <div className="w-[420px] bg-surface-1 flex flex-col animate-slide-in-right shadow-xl">
          <PanelContent
            title={title}
            messages={messages}
            input={input}
            streaming={streaming}
            toolStatus={toolStatus}
            messagesEndRef={messagesEndRef}
            textareaRef={textareaRef}
            onClose={onClose}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            onActionApplied={refreshMessages}
          />
        </div>
      </div>

      {/* Mobile: full-screen overlay */}
      <div className="flex md:hidden fixed inset-0 z-50 bg-surface-1 flex-col animate-slide-up">
        <PanelContent
          title={title}
          messages={messages}
          input={input}
          streaming={streaming}
          toolStatus={toolStatus}
          messagesEndRef={messagesEndRef}
          textareaRef={textareaRef}
          onClose={onClose}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onSend={handleSend}
          onActionApplied={refreshMessages}
        />
      </div>
    </>
  )
}

function PanelContent({ title, messages, input, streaming, toolStatus, messagesEndRef, textareaRef, onClose, onInput, onKeyDown, onSend, onActionApplied }: {
  title?: string
  messages: Message[]
  input: string
  streaming: boolean
  toolStatus: string | null
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onClose: () => void
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onActionApplied: () => void
}) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
          <path d="M10 21h4" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary truncate">
            {title || 'AI Assistent'}
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-tertiary shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-[12px] text-text-tertiary text-center">
              Stel een vraag over je campagnes...
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            id={msg.id}
            role={msg.role}
            content={msg.content}
            proposedActions={msg.proposedActions}
            onActionApplied={onActionApplied}
          />
        ))}
        {toolStatus && (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary px-2">
            <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            {toolStatus}...
          </div>
        )}
        {streaming && !toolStatus && (
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border-subtle shrink-0">
        <div className="flex items-end gap-2 bg-surface-0 border border-border-subtle rounded-xl px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            disabled={streaming}
            placeholder="Stel een vraag..."
            rows={1}
            className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary resize-none outline-none max-h-[120px]"
          />
          <button
            onClick={onSend}
            disabled={streaming || !input.trim()}
            className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-30 shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}
