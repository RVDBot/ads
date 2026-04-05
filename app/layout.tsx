import type { Metadata } from 'next'
import './globals.css'
import ChatProvider from '@/components/ChatProvider'

export const metadata: Metadata = {
  title: 'Ads Optimizer — SpeedRopeShop',
  description: 'AI-gestuurd Google Ads optimalisatie dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body><ChatProvider>{children}</ChatProvider></body>
    </html>
  )
}
