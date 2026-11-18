import { and, eq, gte, lte } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { meals } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

const mealInput = z.object({
  title: z.string().trim().min(2).max(100),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']),
  caloriesKcal: z.number().int().min(0).max(10000),
  proteinGrams: z.number().min(0).max(500),
  carbsGrams: z.number().min(0).max(1000),
  fatGrams: z.number().min(0).max(500),
  ingredients: z.array(z.string().trim().min(1).max(80)).max(30),
  aiNotes: z.string().trim().max(500).optional(),
  loggedAt: z.string().datetime({ offset: true }).optional(),
})

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(new URL(request.url).searchParams.get('day'))
  const day = dayParam.success ? dayParam.data : new Date().toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const items = await db.select().from(meals).where(and(eq(meals.userId, user.id), gte(meals.loggedAt, start), lte(meals.loggedAt, end))).orderBy(meals.loggedAt)
  return NextResponse.json({ meals: items })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const parsed = mealInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Check the meal details and try again.' }, { status: 400 })
  const { loggedAt, ...mealData } = parsed.data
  const [entry] = await db.insert(meals).values({
    userId: user.id,
    ...mealData,
    loggedAt: loggedAt ? new Date(loggedAt) : undefined,
  }).returning()
  return NextResponse.json({ meal: entry }, { status: 201 })
}
