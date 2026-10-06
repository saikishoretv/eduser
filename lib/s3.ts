import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const BUCKET = process.env.AWS_S3_BUCKET!

// Generate a presigned URL for uploading a file directly from the browser
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}

// Generate a presigned URL for downloading/streaming a file
export async function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}

// Delete a file from S3
export async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// Canonical S3 key for a source video
export function sourceKey(userId: string, sourceId: string, fileName: string): string {
  const ext = fileName.split('.').pop() ?? 'mp4'
  return `users/${userId}/sources/${sourceId}.${ext}`
}

// Canonical S3 key for an audio layer
export function audioKey(userId: string, layerId: string, fileName: string): string {
  const ext = fileName.split('.').pop() ?? 'mp3'
  return `users/${userId}/audio/${layerId}.${ext}`
}

// Canonical S3 key for an image overlay
export function imageKey(userId: string, overlayId: string, fileName: string): string {
  const ext = fileName.split('.').pop() ?? 'png'
  return `users/${userId}/images/${overlayId}.${ext}`
}
