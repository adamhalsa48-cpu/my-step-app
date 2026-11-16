import { generateText, Output } from 'ai'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { profiles, workoutPlans } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

export const runtime = 'nodejs'

const planSchema = z.object({
  summary: z.string().min(12).max(220),
  sessions: z.array(z.object({
    day: z.enum(['Day 1', 'Day 2', 'Day 3']),
    title: z.string().min(2).max(80),
    category: z.enum(['strength', 'cardio', 'walking', 'yoga', 'cycling', 'mobility']),
    durationMinutes: z.number().int().min(15).max(60),
    focus: z.string().min(5).max(120),
    exercises: z.array(z.string().min(2).max(100)).min(3).max(6),
    restNote: z.string().min(10).max(160),
  })).length(3),
})
const weekSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const parsed = weekSchema.safeParse(new URL(request.url).searchParams.get('week'))
  const weekOf = parsed.success ? parsed.data : new Date().toISOString().slice(0, 10)
  const [saved] = await db.select().from(workoutPlans).where(and(eq(workoutPlans.userId, user.id), eq(workoutPlans.weekOf, weekOf))).limit(1)
  return NextResponse.json({ plan: saved?.plan ?? null, weekOf })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const input = z.object({ weekOf: weekSchema }).safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Choose a valid plan week.' }, { status: 400 })
  const [profile] = await db.select({ fitnessGoal: profiles.fitnessGoal, bodyGoal: profiles.bodyGoal, muscleFocus: profiles.muscleFocus }).from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  if (!profile) return NextResponse.json({ error: 'Complete your profile first.' }, { status: 404 })

  try {
    const result = await generateText({
      model: 'google/gemini-3.8-flash',
      output: Output.object({ schema: planSchema }),
      prompt: `Create a flexible three-session weekly fitness plan for an adult beginner in a general wellness app. Fitness goal: ${profile.fitnessGoal.replaceAll('_', ' ')}. ${profile.bodyGoal ? `Current muscle phase: ${profile.bodyGoal}.` : ''} ${profile.muscleFocus.length ? `Areas of interest: ${profile.muscleFocus.join(' and ')}.` : ''} Assume no equipment and offer body-weight alternatives. Use distinct sessions with gentle progressions and rest days between harder sessions. Keep each session 15 to 40 minutes, label them Day 1, Day 2, and Day 3, and include a short safety note to stop if movement causes pain and adapt to the user's ability. Avoid claims about guaranteed weight loss, prescriptions, or medical advice.`,
    })
    const plan = planSchema.parse(result.output)
    const [saved] = await db.insert(workoutPlans)
      .values({ userId: user.id, weekOf: input.data.weekOf, plan, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [workoutPlans.userId, workoutPlans.weekOf],
        set: { plan, updatedAt: new Date() },
      })
      .returning()
    return NextResponse.json({ plan: saved.plan, weekOf: saved.weekOf })
  } catch (error) {
    console.error('[stay-fit] workout plan generation failed', error)
    return NextResponse.json({ error: 'Your workout plan could not be created right now. Try again in a moment.' }, { status: 502 })
  }
}
