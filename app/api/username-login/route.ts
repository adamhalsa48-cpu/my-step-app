import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { neonAuthUsers, profiles } from '@/lib/db/schema'
import { capacitorOrigins } from '@/lib/native-origins'

const credentialsSchema = z.object({
  usernameOrEmail: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(128),
})

function sameOriginRequest(request: Request) {
  const origin = request.headers.get('origin')
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')
  if (!origin || !host) return false

  try {
    const parsedOrigin = new URL(origin)
    if (capacitorOrigins.has(parsedOrigin.origin)) return true
    const secureOriginRequired = process.env.NODE_ENV === 'production'
    return parsedOrigin.host === host && (!secureOriginRequired || parsedOrigin.protocol === 'https:')
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: 'This request could not be completed.' }, { status: 403 })

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid username or email and password.' }, { status: 400 })

  const identifier = parsed.data.usernameOrEmail
  let email = /^\S+@\S+\.\S+$/.test(identifier) ? identifier.toLowerCase() : null

  if (!email && /^[a-zA-Z0-9_]{3,24}$/.test(identifier)) {
    const [profile] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.username, identifier.toLowerCase())).limit(1)
    if (profile) {
      const [authUser] = await db.select({ email: neonAuthUsers.email }).from(neonAuthUsers).where(eq(neonAuthUsers.id, profile.userId)).limit(1)
      email = authUser?.email ?? null
    }
  }

  try {
    const result = await auth.signIn.email({
      email: email ?? 'unknown-user@stay-fit.invalid',
      password: parsed.data.password,
    })
    if (result.error) return NextResponse.json({ error: 'We could not sign you in. Check your username or email and password.' }, { status: 401 })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'We could not sign you in. Check your username or email and password.' }, { status: 401 })
  }
}
