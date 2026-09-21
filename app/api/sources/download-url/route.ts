import { auth } from '@/lib/auth'
import { getDownloadUrl } from '@/lib/s3'
import { headers } from 'next/headers'

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { s3Key } = await request.json() as { s3Key: string }
  if (!s3Key) return Response.json({ error: 's3Key is required' }, { status: 400 })

  // Verify the key belongs to this user
  if (!s3Key.startsWith(`users/${session.user.id}/`)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const downloadUrl = await getDownloadUrl(s3Key)
  return Response.json({ downloadUrl })
}
