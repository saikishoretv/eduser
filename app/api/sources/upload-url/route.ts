import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getUploadUrl, sourceKey } from '@/lib/s3'

export async function POST(request: Request) {
  // Authenticate the request
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

  const body = await request.json() as {
    sourceId: string
    fileName: string
    contentType: string
  }

  const { sourceId, fileName, contentType } = body
  if (!sourceId || !fileName || !contentType) {
    return Response.json({ error: 'sourceId, fileName, and contentType are required' }, { status: 400 })
  }

  const key = sourceKey(user.id, sourceId, fileName)
  const uploadUrl = await getUploadUrl(key, contentType)

  return Response.json({ uploadUrl, s3Key: key })
}
