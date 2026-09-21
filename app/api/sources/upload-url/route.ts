import { auth } from '@/lib/auth'
import { getUploadUrl, sourceKey } from '@/lib/s3'
import { headers } from 'next/headers'

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourceId, fileName, contentType } = await request.json() as {
    sourceId: string
    fileName: string
    contentType: string
  }

  if (!sourceId || !fileName || !contentType) {
    return Response.json({ error: 'sourceId, fileName, and contentType are required' }, { status: 400 })
  }

  const key = sourceKey(session.user.id, sourceId, fileName)
  const uploadUrl = await getUploadUrl(key, contentType)

  return Response.json({ uploadUrl, s3Key: key })
}
