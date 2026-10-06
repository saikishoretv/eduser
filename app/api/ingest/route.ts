import { auth } from '@/lib/auth'
import { getDb } from '@/lib/mongodb'
import { s3, sourceKey } from '@/lib/s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { headers } from 'next/headers'

// Server-side S3 upload (bypasses browser CORS issues)
async function uploadToS3(key: string, buffer: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const formData = await request.formData()
  const videoFile  = formData.get('video')   as File   | null
  const stepsJson  = formData.get('steps')   as string | null
  const durationRaw = formData.get('duration') as string | null

  if (!videoFile) return Response.json({ error: 'video is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSteps: Array<{ timelinePosition: number; type: string; title: string; url?: string }> =
    JSON.parse(stepsJson || '[]')

  const duration = parseFloat(durationRaw || '0') || 0

  // Sort by timelinePosition and cap at 20
  const sortedSteps = [...rawSteps].sort((a, b) => a.timelinePosition - b.timelinePosition).slice(0, 20)

  // IDs
  const projectId = crypto.randomUUID()
  const sourceId  = crypto.randomUUID()
  const fileName  = 'recording.webm'
  const s3Key     = sourceKey(userId, sourceId, fileName)

  // Upload video to S3
  const arrayBuffer = await videoFile.arrayBuffer()
  await uploadToS3(s3Key, Buffer.from(arrayBuffer), videoFile.type || 'video/webm')

  // Build clips: one per step region
  const boundaries = [
    ...sortedSteps.map(s => s.timelinePosition),
    duration || (sortedSteps.at(-1)?.timelinePosition ?? 0) + 60,
  ]

  const clipIds: string[] = sortedSteps.map(() => crypto.randomUUID())

  const clips = sortedSteps.map((step, i) => ({
    id: clipIds[i],
    sourceId,
    name: step.title,
    trimStart: boundaries[i],
    trimEnd:   boundaries[i + 1],
  }))

  const steps = sortedSteps.map((step, i) => ({
    id: crypto.randomUUID(),
    clipId: clipIds[i],
    sourceId,
    title: step.title,
    description: '',
    timelinePosition: step.timelinePosition,
  }))

  const source = {
    id: sourceId,
    name: fileName,
    duration,
    width: 0,
    height: 0,
    objectUrl: '',
    s3Key,
  }

  const metadata = {
    clips,
    sources: [source],
    audioLayers: [],
    overlayLayers: [],
    steps,
    clipSpeeds: {},
    clipCrops: {},
    clipZooms: {},
    clipZoomPresets: {},
    clipTransitionDurations: {},
    clipTransitionIn: {},
    clipTransitionOut: {},
    clipColorCorrections: {},
    subtitleStyle: 'off',
  }

  const db = await getDb()
  const now = new Date()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection('projects').insertOne({ _id: projectId as any, userId, name: 'Screen Recording', metadata, createdAt: now, updatedAt: now })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection('sources').insertOne({ _id: sourceId as any, projectId, userId, name: fileName, duration, s3Key, createdAt: now })

  return Response.json({ projectId })
}
