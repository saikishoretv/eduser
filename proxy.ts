import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC_PATHS = ['/login']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Build a response object we can attach refreshed cookies to
  const response = NextResponse.next()

  // Create a server-side Supabase client that reads/writes cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the JWT with Supabase — safe for auth checks
  const { data: { user } } = await supabase.auth.getUser()

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  // Not signed in + trying to access a protected route → login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already signed in + visiting /login → home
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // Only run on page routes and API routes — never on public static files
  matcher: ['/', '/login', '/editor/:path*', '/api/:path*'],
}
