import { auth } from '@/lib/auth'
import { s3 } from '@/lib/s3'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { headers } from 'next/headers'

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  if (!key) return new Response('Missing key', { status: 400 })

  // Prevent path traversal
  if (key.includes('..')) return new Response('Invalid key', { status: 400 })

  const command = new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET!, Key: key })
  const s3res = await s3.send(command)
  if (!s3res.Body) return new Response('Not found', { status: 404 })

  const stream = s3res.Body.transformToWebStream()
  return new Response(stream, {
    headers: {
      'Content-Type': s3res.ContentType ?? 'application/octet-stream',
      ...(s3res.ContentLength ? { 'Content-Length': String(s3res.ContentLength) } : {}),
    },
  })
}
