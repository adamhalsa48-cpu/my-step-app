import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'
import { eq } from 'drizzle-orm'

const profileInput = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().trim().min(1).max(48),
  gender: z.string().trim().min(1).max(40),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.number().min(25).max(400),
  heightCm: z.number().min(100).max(250),
  fitnessGoal: z.enum(['lose_weight', 'stay_fit', 'build_muscle', 'prioritize_nutrition']),
  bodyGoal: z.enum(['bulk', 'cut']).nullable(),
  muscleFocus: z.array(z.enum(['upper_body', 'lower_body'])).max(2),
  dietaryPreferences: z.array(z.string().trim().min(1).max(40)).max(12),
})

export async function GET() {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  return NextResponse.json({ profile: profile ?? null, email: user.email })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const parsed = profileInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check your profile details and try again.' }, { status: 400 })

  const data = parsed.data
  if (data.fitnessGoal === 'build_muscle' && !data.bodyGoal) {
    return NextResponse.json({ error: 'Choose whether you want to bulk or cut.' }, { status: 400 })
  }
  if (data.fitnessGoal !== 'build_muscle' && (data.bodyGoal || data.muscleFocus.length)) {
    return NextResponse.json({ error: 'Muscle-building options are only available for that goal.' }, { status: 400 })
  }

  try {
    const [profile] = await db
      .insert(profiles)
      .values({ userId: user.id, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning()
    return NextResponse.json({ profile })
  } catch (error) {
    console.error('[stay-fit] profile save failed', error)
    return NextResponse.json({ error: 'That username may already be taken. Try another one.' }, { status: 409 })
  }
}

export async function PATCH(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const parsed = z.object({
    leaderboardOptIn: z.boolean().optional(),
    dailyStepGoal: z.number().int().min(1000).max(50000).optional(),
  }).strict().safeParse(await request.json().catch(() => null))
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    return NextResponse.json({ error: 'Choose a valid profile setting.' }, { status: 400 })
  }

  const [profile] = await db
    .update(profiles)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(profiles.userId, user.id))
    .returning()
  if (!profile) return NextResponse.json({ error: 'Complete onboarding first.' }, { status: 404 })
  return NextResponse.json({ profile })
}
