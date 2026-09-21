import { auth } from '@/lib/auth'
import { deleteFile } from '@/lib/s3'
import { headers } from 'next/headers'

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { s3Keys } = await request.json() as { s3Keys: string[] }
  if (!Array.isArray(s3Keys) || s3Keys.length === 0) {
    return Response.json({ error: 's3Keys must be a non-empty array' }, { status: 400 })
  }

  const ownedKeys = s3Keys.filter(k => typeof k === 'string' && k.startsWith(`users/${session.user.id}/`))
  await Promise.allSettled(ownedKeys.map(key => deleteFile(key)))

  return Response.json({ deleted: ownedKeys.length })
}
