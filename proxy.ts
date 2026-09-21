import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  if (isPublic) return NextResponse.next()

  const session = await auth.api.getSession({ headers: request.headers })

  if (!session) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/login', '/editor/:path*', '/api/:path*'],
}
