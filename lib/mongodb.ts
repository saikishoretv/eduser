import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI!

declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined
  // eslint-disable-next-line no-var
  var _mongoConnected: Promise<MongoClient> | undefined
}

function getOrCreateClient(): { client: MongoClient; connected: Promise<MongoClient> } {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri)
    global._mongoConnected = global._mongoClient.connect()
  }
  return { client: global._mongoClient, connected: global._mongoConnected! }
}

const { client, connected } = getOrCreateClient()

export const mongoClient = client

export async function getDb() {
  await connected
  return client.db()
}
