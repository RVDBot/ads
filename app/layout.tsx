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
