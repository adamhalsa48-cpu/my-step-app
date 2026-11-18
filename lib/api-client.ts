import {
  getPendingLocalSync,
  markLocalMealSynced,
  markLocalWorkoutSynced,
  type Profile,
} from '@/lib/local-store'

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

function apiUrl(path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  return `${baseUrl}/api/${path.replace(/^\/+/, '')}`
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(12000),
    })
  } catch (error) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('stay-fit-api-unreachable'))
    throw error
  }
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiRequestError(body.error || 'The online service could not complete this request.', response.status)
  return body as T
}

export type BackendStatus = { reachable: boolean; authenticated: boolean }

export async function checkBackendAndSync(): Promise<BackendStatus> {
  let remoteEmail: string
  try {
    const session = await apiRequest<{ profile: unknown; email?: string }>('profile')
    if (!session.email) return { reachable: true, authenticated: false }
    remoteEmail = session.email
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return { reachable: true, authenticated: false }
    }
    return { reachable: false, authenticated: false }
  }

  try {
    const pending = getPendingLocalSync()
    if (!pending || pending.email.toLowerCase() !== remoteEmail.toLowerCase()) {
      return { reachable: true, authenticated: false }
    }

    const { profile, steps, meals, workouts } = pending
    await apiRequest('profile', { method: 'POST', body: JSON.stringify(profile) })
    await apiRequest('profile', {
      method: 'PATCH',
      body: JSON.stringify({
        dailyStepGoal: profile.dailyStepGoal,
        leaderboardOptIn: profile.leaderboardOptIn,
        weeklyStepGoal: profile.weeklyStepGoal,
        weeklyActiveDaysGoal: profile.weeklyActiveDaysGoal,
        weeklyCalorieGoal: profile.weeklyCalorieGoal,
      }),
    })

    for (const [day, entry] of Object.entries(steps)) {
      await apiRequest('steps', { method: 'POST', body: JSON.stringify({ day, steps: entry.steps, source: entry.source }) })
    }
    for (const meal of meals) {
      await apiRequest('meals', {
        method: 'POST',
        body: JSON.stringify({
          title: meal.title,
          mealType: meal.mealType,
          caloriesKcal: meal.caloriesKcal,
          proteinGrams: meal.proteinGrams,
          carbsGrams: meal.carbsGrams,
          fatGrams: meal.fatGrams,
          ingredients: meal.ingredients,
          aiNotes: meal.aiNotes ?? undefined,
          loggedAt: meal.loggedAt,
        }),
      })
      markLocalMealSynced(meal.id)
    }
    for (const workout of workouts) {
      await apiRequest('workouts', {
        method: 'POST',
        body: JSON.stringify({
          title: workout.title,
          category: workout.category,
          durationMinutes: workout.durationMinutes,
          completedAt: workout.completedAt,
        }),
      })
      markLocalWorkoutSynced(workout.id)
    }
  } catch {
    // Keep unsent device records local and retry on the next online check.
  }

  return { reachable: true, authenticated: true }
}

export async function establishOnlineAccount(input: {
  email: string
  username: string
  password: string
  profile: Profile
}) {
  try {
    await apiRequest('auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: input.profile.displayName, email: input.email, password: input.password }),
    })
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error
    await apiRequest('username-login', {
      method: 'POST',
      body: JSON.stringify({ usernameOrEmail: input.email, password: input.password }),
    })
  }
  await apiRequest('profile', { method: 'POST', body: JSON.stringify(input.profile) })
  await apiRequest('profile', {
    method: 'PATCH',
    body: JSON.stringify({ dailyStepGoal: input.profile.dailyStepGoal, leaderboardOptIn: input.profile.leaderboardOptIn }),
  })
}
