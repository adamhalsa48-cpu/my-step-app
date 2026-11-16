import { generateText, Output } from 'ai'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { mealPlans, profiles } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

export const runtime = 'nodejs'

const planSchema = z.object({
  summary: z.string().min(10).max(240),
  meals: z.array(z.object({
    name: z.string().min(2).max(80),
    type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    description: z.string().min(10).max(220),
    caloriesKcal: z.number().int().min(0).max(2500),
    proteinGrams: z.number().min(0).max(150),
    ingredients: z.array(z.string().min(1).max(80)).max(12),
  })).length(4),
})

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(new URL(request.url).searchParams.get('day'))
  const day = dateParam.success ? dateParam.data : new Date().toISOString().slice(0, 10)
  const [saved] = await db.select().from(mealPlans).where(and(eq(mealPlans.userId, user.id), eq(mealPlans.planDate, day))).limit(1)
  return NextResponse.json({ plan: saved?.plan ?? null, day })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const input = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Choose a valid plan date.' }, { status: 400 })

  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1)
  if (!profile) return NextResponse.json({ error: 'Complete your profile first.' }, { status: 404 })

  try {
    const result = await generateText({
      model: 'google/gemini-3.8-flash',
      output: Output.object({ schema: planSchema }),
      prompt: `Create a practical, balanced one-day meal plan for a general wellness app. The user wants to ${profile.fitnessGoal.replaceAll('_', ' ')}${profile.bodyGoal ? ` and is currently focused on ${profile.bodyGoal}` : ''}. Dietary preferences or restrictions: ${profile.dietaryPreferences.join(', ') || 'none supplied'}. Include breakfast, lunch, dinner, and one snack. Use accessible ingredients, reasonable portions, and approximate nutrition only. Avoid medical claims and do not prescribe an extreme calorie deficit or supplement. Add a short note that the plan is a flexible suggestion, not medical advice.`,
    })
    const plan = planSchema.parse(result.output)
    const [saved] = await db.insert(mealPlans)
      .values({ userId: user.id, planDate: input.data.day, plan, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [mealPlans.userId, mealPlans.planDate],
        set: { plan, updatedAt: new Date() },
      })
      .returning()
    return NextResponse.json({ plan: saved.plan, day: saved.planDate })
  } catch (error) {
    console.error('[stay-fit] meal plan generation failed', error)
    return NextResponse.json({ error: 'Your plan could not be created right now. Try again in a moment.' }, { status: 502 })
  }
}
