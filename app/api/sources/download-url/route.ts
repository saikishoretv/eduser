import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getDownloadUrl } from '@/lib/s3'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { s3Key } = await request.json() as { s3Key: string }
  if (!s3Key) {
    return Response.json({ error: 's3Key is required' }, { status: 400 })
  }

  // Verify the key belongs to this user (path always starts with users/{userId}/)
  if (!s3Key.startsWith(`users/${user.id}/`)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const downloadUrl = await getDownloadUrl(s3Key)
  return Response.json({ downloadUrl })
}
