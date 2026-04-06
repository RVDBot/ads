import type { Metadata } from 'next'
import './globals.css'
import ChatProvider from '@/components/ChatProvider'
import SyncProvider from '@/components/SyncProvider'

export const metadata: Metadata = {
  title: 'Ads Optimizer — SpeedRopeShop',
  description: 'AI-gestuurd Google Ads optimalisatie dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body><SyncProvider><ChatProvider>{children}</ChatProvider></SyncProvider></body>
    </html>
  )
}
