import { getDb } from '@/lib/mongodb'

// Simple admin secret guard — set ADMIN_SECRET in your env
function isAuthorized(request: Request): boolean {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  return request.headers.get('x-admin-secret') === secret
}

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  const db = await getDb()
  const doc = await db.collection('user_limits').findOne({ userId })
  return Response.json({ userId, videoLimit: (doc?.videoLimit as number | undefined) ?? 5 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  const { videoLimit } = await request.json() as { videoLimit: number }

  if (typeof videoLimit !== 'number' || videoLimit < 0) {
    return Response.json({ error: 'videoLimit must be a non-negative number' }, { status: 400 })
  }

  const db = await getDb()
  await db.collection('user_limits').updateOne(
    { userId },
    { $set: { userId, videoLimit, updatedAt: new Date() } },
    { upsert: true },
  )

  return Response.json({ ok: true, userId, videoLimit })
}
