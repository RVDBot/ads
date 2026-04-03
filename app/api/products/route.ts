import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const denied = requireAuth(req); if (denied) return denied
  const country = req.nextUrl.searchParams.get('country')
  const margin = req.nextUrl.searchParams.get('margin')
  const status = req.nextUrl.searchParams.get('status')
  const db = getDb()

  let where = 'WHERE 1=1'
  const params: unknown[] = []
  if (country) { where += ' AND country = ?'; params.push(country) }
  if (margin) { where += ' AND margin_label = ?'; params.push(margin) }
  if (status) { where += ' AND status = ?'; params.push(status) }

  const products = db.prepare(`SELECT * FROM products ${where} ORDER BY title ASC`).all(...params)
  return NextResponse.json({ products })
}
