import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const session = req.cookies.get('session')?.value
  if (!session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    if (origin && host) {
      try {
        const originHost = new URL(origin).host
        if (originHost !== host) {
          return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
