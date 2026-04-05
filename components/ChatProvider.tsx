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
