import { auth } from '@/lib/auth'
import { getDb } from '@/lib/mongodb'
import { deleteFile } from '@/lib/s3'
import { headers } from 'next/headers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()
  const doc = await db.collection('projects').findOne({ _id: id as unknown as string, userId: session.user.id })
  if (!doc) return Response.json({ error: 'Project not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (doc.metadata ?? {}) as Record<string, any>

  return Response.json({
    project: {
      id: doc._id,
      name: doc.name,
      createdAt: new Date(doc.createdAt).getTime(),
      clips:         meta.clips         ?? [],
      sources:       meta.sources       ?? [],
      audioLayers:   meta.audioLayers   ?? [],
      overlayLayers: meta.overlayLayers ?? [],
    },
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { metadata, name } = await request.json() as { metadata: Record<string, any>; name?: string }
  if (!metadata) return Response.json({ error: 'metadata is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { metadata, updatedAt: new Date() }
  if (name) patch.name = name

  const db = await getDb()
  const result = await db.collection('projects').updateOne(
    { _id: id as unknown as string, userId: session.user.id },
    { $set: patch }
  )

  if (result.matchedCount === 0) return Response.json({ error: 'Project not found' }, { status: 404 })

  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = await getDb()

  // Collect S3 keys before deleting
  const sources = await db.collection('sources').find(
    { projectId: id, userId: session.user.id },
    { projection: { s3Key: 1 } }
  ).toArray()

  await db.collection('projects').deleteOne({ _id: id as unknown as string, userId: session.user.id })
  await db.collection('sources').deleteMany({ projectId: id })

  if (sources.length) {
    await Promise.allSettled(sources.map(s => deleteFile(s.s3Key)))
  }

  return Response.json({ ok: true })
}
