import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { dailySteps } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'

const stepInput = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().min(0).max(200000),
  source: z.enum(['manual', 'phone', 'apple-watch']).default('manual'),
})

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })

  const parsed = stepInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a step count between 0 and 200,000.' }, { status: 400 })

  const [entry] = await db
    .insert(dailySteps)
    .values({ userId: user.id, ...parsed.data })
    .onConflictDoUpdate({
      target: [dailySteps.userId, dailySteps.day],
      set: { steps: parsed.data.steps, source: parsed.data.source },
    })
    .returning()
  return NextResponse.json({ entry })
}
