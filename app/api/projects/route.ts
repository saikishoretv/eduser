import { auth } from '@/lib/auth'
import { getDb } from '@/lib/mongodb'
import { headers } from 'next/headers'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const db = await getDb()
  const docs = await db
    .collection('projects')
    .find({ userId }, { projection: { _id: 1, name: 1, createdAt: 1 } })
    .sort({ updatedAt: -1 })
    .toArray()

  const projects = docs.map(p => ({
    id: String(p._id),
    name: p.name as string,
    createdAt: new Date(p.createdAt as string).getTime(),
  }))

  return Response.json({ projects })
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { projectId, name, metadata, sources } = await request.json() as {
    projectId: string
    name: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>
    sources: Array<{ id: string; name: string; duration: number; s3Key: string }>
  }

  if (!projectId || !name) {
    return Response.json({ error: 'projectId and name are required' }, { status: 400 })
  }

  const db = await getDb()
  const now = new Date()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection('projects').insertOne({ _id: projectId as any, userId, name, metadata, createdAt: now, updatedAt: now })

  if (sources?.length) {
    await db.collection('sources').insertMany(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sources.map(s => ({ _id: s.id as any, projectId, userId, name: s.name, duration: s.duration, s3Key: s.s3Key, createdAt: now }))
    )
  }

  return Response.json({ ok: true })
}
