import { s3 } from '@/lib/s3'
import { PutBucketCorsCommand, HeadBucketCommand } from '@aws-sdk/client-s3'

const BUCKET = process.env.AWS_S3_BUCKET!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

export async function GET() {
  // 1. Check bucket is accessible
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch (err: unknown) {
    return Response.json({
      ok: false,
      step: 'bucket-access',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  // 2. Set CORS so browsers can stream video directly from S3
  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [APP_URL, 'http://localhost:3000', 'http://localhost:3001'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type', 'ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }))
  } catch (err: unknown) {
    return Response.json({
      ok: false,
      step: 'set-cors',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  return Response.json({ ok: true, bucket: BUCKET, origin: APP_URL })
}
