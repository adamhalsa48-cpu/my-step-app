import { and, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { dailySteps, friendships, profiles, workouts } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

export async function GET(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const dayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(new URL(request.url).searchParams.get('day'))
  const day = dayInput.success ? dayInput.data : new Date().toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  const [connections, requests] = await Promise.all([
    db.select().from(friendships).where(and(or(eq(friendships.userId, user.id), eq(friendships.friendUserId, user.id)), eq(friendships.status, 'accepted'))),
    db.select().from(friendships).where(and(eq(friendships.friendUserId, user.id), eq(friendships.status, 'pending'))),
  ])
  const friendIds = [...new Set(connections.map((row) => row.userId === user.id ? row.friendUserId : row.userId))]
  const requestIds = [...new Set(requests.map((row) => row.userId))]
  const [friendProfiles, requestProfiles, steps, workoutRows] = await Promise.all([
    friendIds.length ? db.select({ userId: profiles.userId, username: profiles.username, displayName: profiles.displayName, leaderboardOptIn: profiles.leaderboardOptIn }).from(profiles).where(inArray(profiles.userId, friendIds)) : [],
    requestIds.length ? db.select({ userId: profiles.userId, username: profiles.username, displayName: profiles.displayName }).from(profiles).where(inArray(profiles.userId, requestIds)) : [],
    friendIds.length ? db.select({ userId: dailySteps.userId, steps: dailySteps.steps }).from(dailySteps).where(and(inArray(dailySteps.userId, friendIds), eq(dailySteps.day, day))) : [],
    friendIds.length ? db.select({ userId: workouts.userId, caloriesBurned: workouts.caloriesBurned }).from(workouts).where(and(inArray(workouts.userId, friendIds), gte(workouts.completedAt, start), lte(workouts.completedAt, end))) : [],
  ])

  const stepsByUser = new Map(steps.map((row) => [row.userId, row.steps]))
  const caloriesByUser = new Map<string, number>()
  for (const workout of workoutRows) caloriesByUser.set(workout.userId, (caloriesByUser.get(workout.userId) ?? 0) + workout.caloriesBurned)
  const leaderboard = friendProfiles
    .filter((profile) => profile.leaderboardOptIn)
    .map(({ userId, username, displayName }) => ({
      userId,
      username,
      displayName,
      steps: stepsByUser.get(userId) ?? 0,
      caloriesBurned: caloriesByUser.get(userId) ?? 0,
    }))
    .sort((a, b) => b.steps - a.steps)
  const incoming = requests.flatMap((requestRow) => {
    const profile = requestProfiles.find((item) => item.userId === requestRow.userId)
    return profile ? [{ id: requestRow.id, username: profile.username, displayName: profile.displayName }] : []
  })
  return NextResponse.json({ leaderboard, incoming })
}

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const input = z.object({ username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/) }).safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Enter a valid username.' }, { status: 400 })

  const [target] = await db.select({ userId: profiles.userId, username: profiles.username }).from(profiles).where(eq(profiles.username, input.data.username.toLowerCase())).limit(1)
  if (!target) return NextResponse.json({ error: 'No Stay Fit member has that username.' }, { status: 404 })
  if (target.userId === user.id) return NextResponse.json({ error: 'You cannot add yourself.' }, { status: 400 })

  const [existing] = await db.select().from(friendships).where(or(
    and(eq(friendships.userId, user.id), eq(friendships.friendUserId, target.userId)),
    and(eq(friendships.userId, target.userId), eq(friendships.friendUserId, user.id)),
  )).limit(1)
  if (existing?.status === 'pending' && existing.userId === target.userId && existing.friendUserId === user.id) {
    await db.update(friendships).set({ status: 'accepted', updatedAt: new Date() }).where(eq(friendships.id, existing.id))
    return NextResponse.json({ message: 'Friend request accepted.' })
  }
  if (existing) return NextResponse.json({ error: existing.status === 'accepted' ? 'You are already connected.' : 'A request already exists.' }, { status: 409 })

  await db.insert(friendships).values({ userId: user.id, friendUserId: target.userId })
  return NextResponse.json({ message: 'Friend request sent.' }, { status: 201 })
}

export async function PATCH(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const input = z.object({ id: z.number().int().positive(), accept: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Choose a valid friend request.' }, { status: 400 })

  const [updated] = await db.update(friendships)
    .set({ status: input.data.accept ? 'accepted' : 'declined', updatedAt: new Date() })
    .where(and(eq(friendships.id, input.data.id), eq(friendships.friendUserId, user.id), eq(friendships.status, 'pending')))
    .returning({ id: friendships.id })
  if (!updated) return NextResponse.json({ error: 'That request is no longer available.' }, { status: 404 })
  return NextResponse.json({ message: input.data.accept ? 'Friend request accepted.' : 'Request declined.' })
}
