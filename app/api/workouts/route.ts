import { and, eq, gte, lte } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { profiles, workouts } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

const workoutInput = z.object({
  title: z.string().trim().min(2).max(80),
  category: z.enum(['strength', 'cardio', 'walking', 'yoga', 'cycling', 'mobility']),
  durationMinutes: z.number().int().min(1).max(300),
  notes: z.string().trim().max(240).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
})

const metValues = { strength: 5, cardio: 8, walking: 3.5, yoga: 2.5, cycling: 7, mobility: 2.5 } as const

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const url = new URL(request.url)
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(url.searchParams.get('day'))
  const selectedDay = day.success ? day.data : new Date().toISOString().slice(0, 10)
  const start = new Date(`${selectedDay}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const items = await db.select().from(workouts).where(and(eq(workouts.userId, user.id), gte(workouts.completedAt, start), lte(workouts.completedAt, end))).orderBy(workouts.completedAt)
  return NextResponse.json({ workouts: items })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const parsed = workoutInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check the workout details and try again.' }, { status: 400 })

  const [profile] = await db.select({ weightKg: profiles.weightKg }).from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  const weightKg = profile?.weightKg ?? 70
  const { completedAt, ...workoutData } = parsed.data
  const caloriesBurned = Math.round((metValues[workoutData.category] * 3.5 * weightKg * workoutData.durationMinutes) / 200)
  const [entry] = await db.insert(workouts).values({
    userId: user.id,
    ...workoutData,
    caloriesBurned,
    completedAt: completedAt ? new Date(completedAt) : undefined,
  }).returning()
  return NextResponse.json({ workout: entry }, { status: 201 })
}
