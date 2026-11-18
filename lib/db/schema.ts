import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const neonAuthSchema = pgSchema('neon_auth')

export const neonAuthUsers = neonAuthSchema.table('user', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
})

export const profiles = pgTable(
  'stay_fit_profiles',
  {
    userId: text('userId').primaryKey(),
    username: text('username').notNull(),
    displayName: text('displayName').notNull(),
    gender: text('gender').notNull(),
    birthDate: date('birthDate', { mode: 'string' }),
    weightKg: numeric('weightKg', { precision: 5, scale: 2, mode: 'number' }),
    heightCm: numeric('heightCm', { precision: 5, scale: 2, mode: 'number' }),
    fitnessGoal: text('fitnessGoal').notNull(),
    bodyGoal: text('bodyGoal'),
    muscleFocus: text('muscleFocus').array().notNull().default([]),
    dietaryPreferences: text('dietaryPreferences').array().notNull().default([]),
    dailyStepGoal: integer('dailyStepGoal').notNull().default(8000),
    weeklyStepGoal: integer('weeklyStepGoal').notNull().default(70000),
    weeklyActiveDaysGoal: integer('weeklyActiveDaysGoal').notNull().default(5),
    weeklyCalorieGoal: integer('weeklyCalorieGoal').notNull().default(3500),
    leaderboardOptIn: boolean('leaderboardOptIn').notNull().default(false),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_profiles_username_idx').on(table.username)],
)

export const dailySteps = pgTable(
  'stay_fit_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    steps: integer('steps').notNull().default(0),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_steps_user_day_idx').on(table.userId, table.day)],
)

export const activityDays = pgTable(
  'stay_fit_activity_days',
  {
    userId: text('userId').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    activeCalories: integer('activeCalories').notNull().default(0),
    restingHeartRate: integer('restingHeartRate'),
    averageHeartRate: integer('averageHeartRate'),
    workoutMinutes: integer('workoutMinutes').notNull().default(0),
    distanceMeters: numeric('distanceMeters', { precision: 10, scale: 2, mode: 'number' }).notNull().default(0),
    syncedAt: timestamp('syncedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_activity_days_user_day_idx').on(table.userId, table.day)],
)

export const appleWatchTokens = pgTable(
  'stay_fit_watch_tokens',
  {
    userId: text('userId').primaryKey(),
    tokenHash: text('tokenHash').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_watch_tokens_hash_idx').on(table.tokenHash)],
)

export const workouts = pgTable(
  'stay_fit_workouts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull().default('general'),
    durationMinutes: integer('durationMinutes').notNull(),
    caloriesBurned: integer('caloriesBurned').notNull().default(0),
    completedAt: timestamp('completedAt', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('stay_fit_workouts_user_completed_idx').on(table.userId, table.completedAt)],
)

export const meals = pgTable(
  'stay_fit_meals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    title: text('title').notNull(),
    mealType: text('mealType').notNull().default('meal'),
    caloriesKcal: integer('caloriesKcal').notNull().default(0),
    proteinGrams: numeric('proteinGrams', { precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
    carbsGrams: numeric('carbsGrams', { precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
    fatGrams: numeric('fatGrams', { precision: 6, scale: 1, mode: 'number' }).notNull().default(0),
    ingredients: text('ingredients').array().notNull().default([]),
    aiNotes: text('aiNotes'),
    loggedAt: timestamp('loggedAt', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('stay_fit_meals_user_logged_idx').on(table.userId, table.loggedAt)],
)

export const mealPlans = pgTable(
  'stay_fit_meal_plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    planDate: date('planDate', { mode: 'string' }).notNull(),
    plan: jsonb('plan').notNull().$type<{
      summary: string
      meals: Array<{
        name: string
        type: string
        description: string
        caloriesKcal: number
        proteinGrams: number
        ingredients: string[]
      }>
    }>(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_meal_plans_user_date_idx').on(table.userId, table.planDate)],
)

export const workoutPlans = pgTable(
  'stay_fit_workout_plans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    weekOf: date('weekOf', { mode: 'string' }).notNull(),
    plan: jsonb('plan').notNull().$type<{
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
    }>(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('stay_fit_workout_plans_user_week_idx').on(table.userId, table.weekOf)],
)

export const friendships = pgTable(
  'stay_fit_friends',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('userId').notNull(),
    friendUserId: text('friendUserId').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stay_fit_friends_pair_idx').on(table.userId, table.friendUserId),
    index('stay_fit_friends_friend_status_idx').on(table.friendUserId, table.status),
  ],
)
