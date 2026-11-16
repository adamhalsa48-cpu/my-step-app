import { and, eq, gte, lte } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { dailySteps, meals, profiles, workouts } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const url = new URL(request.url)
  const parsedDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(url.searchParams.get('day'))
  const today = parsedDay.success ? parsedDay.data : new Date().toISOString().slice(0, 10)
  const { start, end } = dayBounds(today)
  const weekStart = new Date(start.getTime() - 6 * 24 * 60 * 60 * 1000)

  const [profileRows, stepRows, mealRows, weekWorkoutRows, todayWorkoutRows, weekStepRows] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1),
    db.select({ steps: dailySteps.steps, source: dailySteps.source }).from(dailySteps).where(and(eq(dailySteps.userId, user.id), eq(dailySteps.day, today))).limit(1),
    db.select().from(meals).where(and(eq(meals.userId, user.id), gte(meals.loggedAt, start), lte(meals.loggedAt, end))).orderBy(meals.loggedAt),
    db.select().from(workouts).where(and(eq(workouts.userId, user.id), gte(workouts.completedAt, weekStart))).orderBy(workouts.completedAt),
    db.select().from(workouts).where(and(eq(workouts.userId, user.id), gte(workouts.completedAt, start), lte(workouts.completedAt, end))).orderBy(workouts.completedAt),
    db.select({ day: dailySteps.day, steps: dailySteps.steps }).from(dailySteps).where(and(eq(dailySteps.userId, user.id), gte(dailySteps.day, weekStart.toISOString().slice(0, 10)), lte(dailySteps.day, today))).orderBy(dailySteps.day),
  ])

  const profile = profileRows[0] ?? null
  const weeklySteps = new Map(weekStepRows.map((row) => [row.day, row.steps]))
  const stepsLastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return { day: date, steps: weeklySteps.get(date) ?? 0 }
  })

  return NextResponse.json({
    profile,
    stepsToday: stepRows[0]?.steps ?? 0,
    stepSource: stepRows[0]?.source ?? 'manual',
    stepsLastSevenDays,
    workoutsToday: todayWorkoutRows,
    workoutsThisWeek: weekWorkoutRows,
    mealsToday: mealRows,
    stats: {
      caloriesBurnedToday: todayWorkoutRows.reduce((total, workout) => total + workout.caloriesBurned, 0),
      caloriesBurnedThisWeek: weekWorkoutRows.reduce((total, workout) => total + workout.caloriesBurned, 0),
      workoutsThisWeek: weekWorkoutRows.length,
      caloriesConsumedToday: mealRows.reduce((total, meal) => total + meal.caloriesKcal, 0),
      proteinToday: mealRows.reduce((total, meal) => total + meal.proteinGrams, 0),
    },
  })
}
