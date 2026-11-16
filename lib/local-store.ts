export type Profile = {
  username: string
  displayName: string
  gender: string
  birthDate: string
  weightKg: number
  heightCm: number
  fitnessGoal: string
  bodyGoal: string | null
  muscleFocus: string[]
  dietaryPreferences: string[]
  dailyStepGoal: number
  leaderboardOptIn: boolean
}

export type Workout = {
  id: number
  title: string
  category: string
  durationMinutes: number
  caloriesBurned: number
  completedAt: string
}

export type Meal = {
  id: number
  title: string
  mealType: string
  caloriesKcal: number
  proteinGrams: number
  carbsGrams: number
  fatGrams: number
  ingredients: string[]
  aiNotes: string | null
  loggedAt: string
}

export type MealPlan = {
  summary: string
  meals: Array<{
    name: string
    type: string
    description: string
    caloriesKcal: number
    proteinGrams: number
    ingredients: string[]
  }>
}

export type WorkoutPlan = {
  summary: string
  sessions: Array<{
    day: string
    title: string
    category: 'strength' | 'cardio' | 'walking' | 'yoga' | 'cycling' | 'mobility'
    durationMinutes: number
    focus: string
    exercises: string[]
    restNote: string
  }>
}

export type DashboardData = {
  profile: Profile
  stepsToday: number
  stepSource: string
  stepsLastSevenDays: Array<{ day: string; steps: number }>
  workoutsToday: Workout[]
  workoutsThisWeek: Workout[]
  mealsToday: Meal[]
  stats: {
    caloriesBurnedToday: number
    caloriesBurnedThisWeek: number
    workoutsThisWeek: number
    caloriesConsumedToday: number
    proteinToday: number
  }
}

export type FriendsData = {
  leaderboard: Array<{ userId: string; username: string; displayName: string; steps: number; caloriesBurned: number }>
  incoming: Array<{ id: number; username: string; displayName: string }>
}

type LocalAccount = {
  id: string
  email: string
  username: string
  passwordHash: string
  salt: string
  profile: Profile
  steps: Record<string, { steps: number; source: string }>
  workouts: Workout[]
  meals: Meal[]
  mealPlans: Record<string, MealPlan>
  workoutPlans: Record<string, WorkoutPlan>
  syncedMealIds?: number[]
  syncedWorkoutIds?: number[]
}

type Friendship = { id: number; fromUserId: string; toUserId: string; status: 'pending' | 'accepted' }
type LocalStore = { accounts: LocalAccount[]; friendships: Friendship[] }

const STORE_KEY = 'stay-fit.local.v1'
const SESSION_KEY = 'stay-fit.session.v1'
const DEFAULT_STORE: LocalStore = { accounts: [], friendships: [] }

function readStore(): LocalStore {
  if (typeof window === 'undefined') return DEFAULT_STORE
  try {
    const value = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null') as Partial<LocalStore> | null
    return {
      accounts: Array.isArray(value?.accounts) ? value.accounts : [],
      friendships: Array.isArray(value?.friendships) ? value.friendships : [],
    }
  } catch {
    return DEFAULT_STORE
  }
}

function writeStore(store: LocalStore) {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

function getSessionId() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SESSION_KEY)
}

function currentAccount(store = readStore()) {
  const id = getSessionId()
  return store.accounts.find((account) => account.id === id) ?? null
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function hashPassword(password: string, salt: string) {
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 180_000 },
    key,
    256,
  )
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function legacyHashPassword(password: string, salt: string) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createLocalAccount(input: {
  email: string
  password: string
  profile: Profile
}) {
  const store = readStore()
  const email = input.email.trim().toLowerCase()
  const username = input.profile.username.trim().toLowerCase()
  if (store.accounts.some((account) => account.email === email)) throw new Error('That email is already saved on this device.')
  if (store.accounts.some((account) => account.username === username)) throw new Error('That username is already used on this device.')
  const salt = createId()
  const account: LocalAccount = {
    id: createId(),
    email,
    username,
    passwordHash: await hashPassword(input.password, salt),
    salt,
    profile: { ...input.profile, username, dailyStepGoal: 8000, leaderboardOptIn: false },
    steps: {},
    workouts: [],
    meals: [],
    mealPlans: {},
    workoutPlans: {},
    syncedMealIds: [],
    syncedWorkoutIds: [],
  }
  store.accounts.push(account)
  writeStore(store)
  window.localStorage.setItem(SESSION_KEY, account.id)
  return account.profile
}

export async function signInLocal(identity: string, password: string) {
  const store = readStore()
  const normalized = identity.trim().toLowerCase()
  const account = store.accounts.find((item) => item.email === normalized || item.username === normalized)
  if (!account) throw new Error('We could not sign you in. Check your username or email and password.')
  const currentHash = await hashPassword(password, account.salt)
  if (currentHash !== account.passwordHash) {
    if ((await legacyHashPassword(password, account.salt)) !== account.passwordHash) {
      throw new Error('We could not sign you in. Check your username or email and password.')
    }
    account.passwordHash = currentHash
    writeStore(store)
  }
  window.localStorage.setItem(SESSION_KEY, account.id)
  return account.profile
}

export function signOutLocal() {
  window.localStorage.removeItem(SESSION_KEY)
}

export function getPendingLocalSync() {
  const account = currentAccount()
  if (!account) return null
  const syncedMeals = new Set(account.syncedMealIds ?? [])
  const syncedWorkouts = new Set(account.syncedWorkoutIds ?? [])
  return {
    email: account.email,
    profile: account.profile,
    steps: account.steps,
    meals: account.meals.filter((meal) => !syncedMeals.has(meal.id)),
    workouts: account.workouts.filter((workout) => !syncedWorkouts.has(workout.id)),
  }
}

export function markLocalMealSynced(id: number) {
  updateCurrentAccount((account) => {
    account.syncedMealIds = [...new Set([...(account.syncedMealIds ?? []), id])]
  })
}

export function markLocalWorkoutSynced(id: number) {
  updateCurrentAccount((account) => {
    account.syncedWorkoutIds = [...new Set([...(account.syncedWorkoutIds ?? []), id])]
  })
}

export function getCurrentProfile() {
  return currentAccount()?.profile ?? null
}

export function getCurrentLocalAccount() {
  const account = currentAccount()
  return account ? { email: account.email, profile: account.profile } : null
}

function updateCurrentAccount(update: (account: LocalAccount, store: LocalStore) => void) {
  const store = readStore()
  const account = currentAccount(store)
  if (!account) throw new Error('Your local session has ended. Sign in again.')
  update(account, store)
  writeStore(store)
  return account
}

export function updateLocalProfile(patch: Partial<Profile>) {
  const account = updateCurrentAccount((current) => {
    current.profile = { ...current.profile, ...patch }
  })
  return account.profile
}

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekStart(date = new Date()) {
  const monday = new Date(date)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return localDay(monday)
}

function asDay(value: string) {
  return localDay(new Date(value))
}

export function getDashboardData(day = localDay()): DashboardData | null {
  const account = currentAccount()
  if (!account) return null
  const todayMeals = account.meals.filter((meal) => asDay(meal.loggedAt) === day).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
  const todayWorkouts = account.workouts.filter((workout) => asDay(workout.completedAt) === day)
  const week = weekStart()
  const weekWorkouts = account.workouts.filter((workout) => asDay(workout.completedAt) >= week).sort((a, b) => a.completedAt.localeCompare(b.completedAt))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${day}T12:00:00`)
    date.setDate(date.getDate() - 6 + index)
    const dateKey = localDay(date)
    return { day: dateKey, steps: account.steps[dateKey]?.steps ?? 0 }
  })
  const stepValue = account.steps[day]
  return {
    profile: account.profile,
    stepsToday: stepValue?.steps ?? 0,
    stepSource: stepValue?.source ?? 'manual',
    stepsLastSevenDays: days,
    workoutsToday: todayWorkouts,
    workoutsThisWeek: weekWorkouts,
    mealsToday: todayMeals,
    stats: {
      caloriesBurnedToday: todayWorkouts.reduce((sum, item) => sum + item.caloriesBurned, 0),
      caloriesBurnedThisWeek: weekWorkouts.reduce((sum, item) => sum + item.caloriesBurned, 0),
      workoutsThisWeek: weekWorkouts.length,
      caloriesConsumedToday: todayMeals.reduce((sum, item) => sum + item.caloriesKcal, 0),
      proteinToday: todayMeals.reduce((sum, item) => sum + item.proteinGrams, 0),
    },
  }
}

export function saveLocalSteps(day: string, steps: number, source: string) {
  if (!Number.isInteger(steps) || steps < 0 || steps > 200000) throw new Error('Enter a step count from 0 to 200,000.')
  updateCurrentAccount((account) => {
    account.steps[day] = { steps, source }
  })
  return getDashboardData(day)
}

export function saveLocalWorkout(input: { title: string; category: string; durationMinutes: number }) {
  const durationMinutes = Math.round(input.durationMinutes)
  if (!input.title.trim() || durationMinutes < 1 || durationMinutes > 300) throw new Error('Enter a workout and duration from 1 to 300 minutes.')
  updateCurrentAccount((account) => {
    const factor: Record<string, number> = { strength: 6, cardio: 9, walking: 4, yoga: 3, cycling: 8, mobility: 3 }
    const caloriesBurned = Math.round((account.profile.weightKg || 65) * (factor[input.category] ?? 5) * durationMinutes / 60)
    account.workouts.push({ id: Date.now(), title: input.title.trim().slice(0, 100), category: input.category, durationMinutes, caloriesBurned, completedAt: new Date().toISOString() })
  })
}

export function saveLocalMeal(input: Omit<Meal, 'id' | 'loggedAt'>) {
  if (!input.title.trim() || !Number.isFinite(input.caloriesKcal) || input.caloriesKcal < 0) throw new Error('Enter valid meal details.')
  const meal: Meal = { ...input, title: input.title.trim().slice(0, 100), id: Date.now(), loggedAt: new Date().toISOString() }
  updateCurrentAccount((account) => {
    account.meals.push(meal)
  })
  return meal
}

export function getLocalMealPlan(day: string) {
  return currentAccount()?.mealPlans[day] ?? null
}

export function cacheLocalMealPlan(day: string, plan: MealPlan) {
  updateCurrentAccount((account) => {
    account.mealPlans[day] = plan
  })
  return plan
}

export function createLocalMealPlan(day: string): MealPlan {
  const profile = currentAccount()?.profile
  const preference = profile?.dietaryPreferences[0]
  const plan: MealPlan = {
    summary: `A flexible, offline meal outline${preference ? ` mindful of your ${preference.toLowerCase()} preference` : ''}. Portions and nutrition are general estimates, not medical advice.`,
    meals: [
      { name: 'Oats with fruit', type: 'breakfast', description: 'A simple bowl with oats, fruit, and a spoon of nut butter.', caloriesKcal: 380, proteinGrams: 14, ingredients: ['Oats', 'Fruit', 'Nut butter'] },
      { name: 'Grain and greens bowl', type: 'lunch', description: 'Whole grains, leafy greens, and a protein you enjoy.', caloriesKcal: 520, proteinGrams: 28, ingredients: ['Brown rice', 'Leafy greens', 'Beans or tofu'] },
      { name: 'Yogurt and berries', type: 'snack', description: 'A quick snack with yogurt and seasonal berries.', caloriesKcal: 210, proteinGrams: 15, ingredients: ['Yogurt', 'Berries'] },
      { name: 'Roasted vegetables and protein', type: 'dinner', description: 'Roasted vegetables with a balanced protein and grain.', caloriesKcal: 560, proteinGrams: 32, ingredients: ['Seasonal vegetables', 'Lentils or chicken', 'Quinoa'] },
    ],
  }
  updateCurrentAccount((account) => {
    account.mealPlans[day] = plan
  })
  return plan
}

export function getLocalWorkoutPlan(week: string) {
  return currentAccount()?.workoutPlans[week] ?? null
}

export function cacheLocalWorkoutPlan(week: string, plan: WorkoutPlan) {
  updateCurrentAccount((account) => {
    account.workoutPlans[week] = plan
  })
  return plan
}

export function createLocalWorkoutPlan(week: string): WorkoutPlan {
  const profile = currentAccount()?.profile
  const strength = profile?.fitnessGoal === 'build_muscle'
  const plan: WorkoutPlan = {
    summary: `A flexible, offline four-session plan for your goal to ${profile?.fitnessGoal.replaceAll('_', ' ') ?? 'stay active'}. Adjust intensity and rest to suit how you feel.`,
    sessions: [
      { day: 'Monday', title: strength ? 'Full-body strength' : 'Brisk walk', category: strength ? 'strength' : 'walking', durationMinutes: 30, focus: strength ? 'Practice controlled, full-body movements.' : 'Build a comfortable walking routine.', exercises: strength ? ['Bodyweight squats', 'Wall push-ups', 'Glute bridges'] : ['Easy warm-up', 'Steady walk', 'Gentle cool-down'], restNote: 'Stop if you feel pain, dizziness, or unusual discomfort.' },
      { day: 'Wednesday', title: 'Mobility and balance', category: 'mobility', durationMinutes: 20, focus: 'Move gently through a comfortable range.', exercises: ['Shoulder circles', 'Hip hinges', 'Single-leg balance near support'], restNote: 'Keep movements comfortable and take breaks as needed.' },
      { day: 'Friday', title: strength ? 'Strength and stability' : 'Easy cycling', category: strength ? 'strength' : 'cycling', durationMinutes: 25, focus: 'Keep a steady pace and prioritize form.', exercises: strength ? ['Step-ups', 'Incline push-ups', 'Bird dogs'] : ['Easy warm-up', 'Comfortable cycling', 'Cool-down'], restNote: 'Rest between sets and choose an effort that feels manageable.' },
      { day: 'Saturday', title: 'Recovery yoga', category: 'yoga', durationMinutes: 20, focus: 'Relax and restore with gentle movement.', exercises: ['Cat-cow', 'Low lunge stretch', 'Child’s pose'], restNote: 'Avoid forcing stretches or pushing into pain.' },
    ],
  }
  updateCurrentAccount((account) => {
    account.workoutPlans[week] = plan
  })
  return plan
}

export function getFriendsData(day = localDay()): FriendsData {
  const store = readStore()
  const account = currentAccount(store)
  if (!account) return { leaderboard: [], incoming: [] }
  const incoming = store.friendships
    .filter((friendship) => friendship.toUserId === account.id && friendship.status === 'pending')
    .map((friendship) => {
      const sender = store.accounts.find((item) => item.id === friendship.fromUserId)
      return sender ? { id: friendship.id, username: sender.username, displayName: sender.profile.displayName } : null
    })
    .filter((friend): friend is NonNullable<typeof friend> => friend !== null)
  const leaderboard = store.friendships
    .filter((friendship) => friendship.status === 'accepted' && (friendship.fromUserId === account.id || friendship.toUserId === account.id))
    .map((friendship) => {
      const user = store.accounts.find((item) => item.id === (friendship.fromUserId === account.id ? friendship.toUserId : friendship.fromUserId))
      if (!user?.profile.leaderboardOptIn) return null
      const caloriesBurned = user.workouts.filter((workout) => asDay(workout.completedAt) === day).reduce((sum, workout) => sum + workout.caloriesBurned, 0)
      return { userId: user.id, username: user.username, displayName: user.profile.displayName, steps: user.steps[day]?.steps ?? 0, caloriesBurned }
    })
    .filter((friend): friend is NonNullable<typeof friend> => friend !== null)
    .sort((a, b) => b.steps - a.steps)
  return { leaderboard, incoming }
}

export function sendLocalFriendRequest(username: string) {
  const store = readStore()
  const account = currentAccount(store)
  if (!account) throw new Error('Sign in again to continue.')
  const target = store.accounts.find((item) => item.username === username.trim().toLowerCase())
  if (!target) throw new Error('That username is not saved in a profile on this device. Local-only circles cannot search online accounts.')
  if (target.id === account.id) throw new Error('You cannot add your own profile.')
  if (store.friendships.some((item) => (item.fromUserId === account.id && item.toUserId === target.id) || (item.fromUserId === target.id && item.toUserId === account.id))) {
    throw new Error('A local connection with that profile already exists.')
  }
  store.friendships.push({ id: Date.now(), fromUserId: account.id, toUserId: target.id, status: 'pending' })
  writeStore(store)
  return { message: 'Local friend request saved on this device.' }
}

export function answerLocalFriendRequest(id: number, accept: boolean) {
  const store = readStore()
  const account = currentAccount(store)
  const request = store.friendships.find((item) => item.id === id && item.toUserId === account?.id && item.status === 'pending')
  if (!request) throw new Error('That local request is no longer available.')
  if (accept) request.status = 'accepted'
  else store.friendships = store.friendships.filter((item) => item.id !== id)
  writeStore(store)
  return { message: accept ? 'Local friend request accepted.' : 'Local friend request declined.' }
}
