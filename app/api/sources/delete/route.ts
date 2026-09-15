import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { deleteFile } from '@/lib/s3'

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

  const { s3Keys } = await request.json() as { s3Keys: string[] }
  if (!Array.isArray(s3Keys) || s3Keys.length === 0) {
    return Response.json({ error: 's3Keys must be a non-empty array' }, { status: 400 })
  }

  // Only delete keys that belong to this user
  const ownedKeys = s3Keys.filter(k => typeof k === 'string' && k.startsWith(`users/${user.id}/`))

  await Promise.allSettled(ownedKeys.map(key => deleteFile(key)))

  return Response.json({ deleted: ownedKeys.length })
}
