import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const globalForPool = globalThis as typeof globalThis & { stayFitPool?: Pool }

export const pool =
  globalForPool.stayFitPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  })

if (process.env.NODE_ENV !== 'production') globalForPool.stayFitPool = pool

export const db = drizzle(pool, { schema })
