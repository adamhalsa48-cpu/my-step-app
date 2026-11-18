import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gte, lte } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { activityDays, appleWatchTokens, dailySteps, profiles } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

export const dynamic = 'force-dynamic'

const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const isCalendarDay = (value: string) => {
  if (!dayPattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
const activityInput = z.object({
  day: z.string().refine(isCalendarDay),
  steps: z.number().int().min(0).max(200000),
  activeCalories: z.number().int().min(0).max(10000).default(0),
  restingHeartRate: z.number().int().min(30).max(250).nullable().default(null),
  averageHeartRate: z.number().int().min(30).max(250).nullable().default(null),
  workoutMinutes: z.number().int().min(0).max(1440).default(0),
  distanceMeters: z.number().min(0).max(200000).default(0),
}).strict()

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

async function getAuthorizedUser(request: Request) {
  const sessionUser = await getSignedInUser()
  if (sessionUser) return sessionUser

  const token = tokenFromRequest(request)
  if (!token || token.length > 256) return null
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const [stored] = await db.select({ userId: appleWatchTokens.userId }).from(appleWatchTokens).where(eq(appleWatchTokens.tokenHash, tokenHash)).limit(1)
  return stored ? { id: stored.userId } : null
}

export async function GET(request: Request) {
  const user = await getAuthorizedUser(request)
  if (!user) return NextResponse.json({ error: 'Sign in or use your Apple Health sync token.' }, { status: 401 })

  const url = new URL(request.url)
  const today = new Date().toISOString().slice(0, 10)
  const fromValue = url.searchParams.get('from') ?? url.searchParams.get('day') ?? today
  const toValue = url.searchParams.get('to') ?? url.searchParams.get('day') ?? today
  if (!isCalendarDay(fromValue) || !isCalendarDay(toValue) || fromValue > toValue) {
    return NextResponse.json({ error: 'Choose a valid date range.' }, { status: 400 })
  }
  const start = new Date(`${fromValue}T00:00:00.000Z`)
  const end = new Date(`${toValue}T00:00:00.000Z`)
  if ((end.getTime() - start.getTime()) / 86400000 > 41) {
    return NextResponse.json({ error: 'Choose a date range of 42 days or less.' }, { status: 400 })
  }

  const [steps, activities, profileRows] = await Promise.all([
    db.select({ day: dailySteps.day, steps: dailySteps.steps, source: dailySteps.source }).from(dailySteps)
      .where(and(eq(dailySteps.userId, user.id), gte(dailySteps.day, fromValue), lte(dailySteps.day, toValue))),
    db.select().from(activityDays)
      .where(and(eq(activityDays.userId, user.id), gte(activityDays.day, fromValue), lte(activityDays.day, toValue))),
    db.select({ weeklyStepGoal: profiles.weeklyStepGoal, weeklyActiveDaysGoal: profiles.weeklyActiveDaysGoal, weeklyCalorieGoal: profiles.weeklyCalorieGoal })
      .from(profiles).where(eq(profiles.userId, user.id)).limit(1),
  ])
  const stepByDay = new Map(steps.map((entry) => [entry.day, entry]))
  const activityByDay = new Map(activities.map((entry) => [entry.day, entry]))
  const history = Array.from({ length: Math.floor((end.getTime() - start.getTime()) / 86400000) + 1 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)
    const activity = activityByDay.get(day)
    return {
      day,
      steps: stepByDay.get(day)?.steps ?? 0,
      source: stepByDay.get(day)?.source ?? 'manual',
      activity: activity ? {
        activeCalories: activity.activeCalories,
        restingHeartRate: activity.restingHeartRate,
        averageHeartRate: activity.averageHeartRate,
        workoutMinutes: activity.workoutMinutes,
        distanceMeters: activity.distanceMeters,
        syncedAt: activity.syncedAt.toISOString(),
      } : null,
    }
  })
  const savedGoals = profileRows[0]
  return NextResponse.json({
    history,
    goals: savedGoals ? {
      weeklyStepGoal: savedGoals.weeklyStepGoal,
      weeklyActiveDaysGoal: savedGoals.weeklyActiveDaysGoal,
      weeklyCalorieGoal: savedGoals.weeklyCalorieGoal,
    } : null,
  })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as unknown
  const action = z.object({ action: z.literal('create-token') }).safeParse(body)
  if (action.success) {
    const user = await getSignedInUser()
    if (!user) return NextResponse.json({ error: 'Sign in online to create a sync token.' }, { status: 401 })
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await db.insert(appleWatchTokens).values({ userId: user.id, tokenHash, createdAt: new Date() }).onConflictDoUpdate({
      target: appleWatchTokens.userId,
      set: { tokenHash, createdAt: new Date() },
    })
    return NextResponse.json({ token })
  }

  const user = await getAuthorizedUser(request)
  if (!user) return NextResponse.json({ error: 'Sign in or use your Apple Health sync token.' }, { status: 401 })
  const parsed = activityInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Check the activity values and try again.' }, { status: 400 })

  const values = parsed.data
  const syncedAt = new Date()
  await Promise.all([
    db.insert(dailySteps).values({ userId: user.id, day: values.day, steps: values.steps, source: 'apple-watch' }).onConflictDoUpdate({
      target: [dailySteps.userId, dailySteps.day],
      set: { steps: values.steps, source: 'apple-watch' },
    }),
    db.insert(activityDays).values({
      userId: user.id,
      day: values.day,
      activeCalories: values.activeCalories,
      restingHeartRate: values.restingHeartRate,
      averageHeartRate: values.averageHeartRate,
      workoutMinutes: values.workoutMinutes,
      distanceMeters: values.distanceMeters,
      syncedAt,
    }).onConflictDoUpdate({
      target: [activityDays.userId, activityDays.day],
      set: {
        activeCalories: values.activeCalories,
        restingHeartRate: values.restingHeartRate,
        averageHeartRate: values.averageHeartRate,
        workoutMinutes: values.workoutMinutes,
        distanceMeters: values.distanceMeters,
        syncedAt,
      },
    }),
  ])
  return NextResponse.json({ ok: true, day: values.day, syncedAt: syncedAt.toISOString() })
}
