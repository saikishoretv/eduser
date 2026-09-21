import { MongoClient, Db } from 'mongodb'

const uri = process.env.MONGODB_URI!

let client: MongoClient
let db: Db

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
}

async function connect() {
  if (db) return db

  if (process.env.NODE_ENV === 'development') {
    // Reuse across hot reloads in dev
    if (!global._mongoClient) {
      global._mongoClient = new MongoClient(uri)
      await global._mongoClient.connect()
    }
    client = global._mongoClient
  } else {
    client = new MongoClient(uri)
    await client.connect()
  }

  db = client.db()
  return db
}

export async function getDb() {
  return connect()
}
