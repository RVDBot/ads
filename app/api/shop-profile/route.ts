import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const db = getDb()
  const profiles = db.prepare('SELECT * FROM shop_profile ORDER BY country').all()
  return NextResponse.json({ profiles })
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const body = await req.json()
  const { country } = body

  if (country) {
    const { crawlAndGenerateProfile } = await import('@/lib/shop-profile')
    const profile = await crawlAndGenerateProfile(country)
    return NextResponse.json({ profile })
  } else {
    const { crawlAllProfiles } = await import('@/lib/shop-profile')
    await crawlAllProfiles()
    const db = getDb()
    const profiles = db.prepare('SELECT * FROM shop_profile ORDER BY country').all()
    return NextResponse.json({ profiles })
  }
}
