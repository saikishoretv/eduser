import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getMasterKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('KEY_ENCRYPTION_SECRET is not set')
  const buf = Buffer.from(secret, 'hex')
  if (buf.length !== 32) throw new Error('KEY_ENCRYPTION_SECRET must be 64 hex chars (32 bytes)')
  return buf
}

export function encryptKey(plaintext: string): { encryptedKey: string; iv: string; authTag: string } {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    encryptedKey: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  }
}

export function decryptKey(encryptedKey: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '***'
  return key.slice(0, 4) + '...' + key.slice(-4)
}
